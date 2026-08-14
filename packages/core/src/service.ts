import type {
  AgentAdvice,
  AgentDriver,
  CreateLoopInput,
  EventStore,
  HumanDecision,
  HumanPrior,
  LoopAggregate,
  LoopCycle,
  LoopEvent,
  Observation,
  Revision,
} from "./domain";
import { getActiveCycle, reduceLoop } from "./reducer";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now(): string {
  return new Date().toISOString();
}

function event<T>(loopId: string, version: number, type: LoopEvent<T>["type"], payload: T): LoopEvent<T> {
  return { id: id("evt"), loopId, version, type, occurredAt: now(), payload };
}

function assertStatus(loop: LoopAggregate, expected: LoopAggregate["status"], action: string): void {
  if (loop.status !== expected) {
    throw new Error(`${action} requires status ${expected}; current status is ${loop.status}.`);
  }
}

function assertFiniteRange(value: number, minimum: number, maximum: number, field: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
}

export class LoopService {
  constructor(
    private readonly store: EventStore,
    private readonly agent: AgentDriver,
  ) {}

  async list(): Promise<LoopAggregate[]> {
    const loops = await Promise.all((await this.store.listLoopIds()).map((loopId) => this.get(loopId)));
    return loops.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(loopId: string): Promise<LoopAggregate> {
    const events = await this.store.read(loopId);
    if (events.length === 0) throw new Error(`Loop ${loopId} was not found.`);
    return reduceLoop(events);
  }

  async create(input: CreateLoopInput): Promise<LoopAggregate> {
    if (!input.name.trim() || !input.intent.trim()) throw new Error("Name and intent are required.");
    if (!input.horizon.trim()) throw new Error("A finite Loop horizon is required.");
    if (input.objectives.length === 0) throw new Error("At least one objective is required.");
    if (input.objectives.some((item) => !item.name.trim() || !item.target.trim())) {
      throw new Error("Every objective needs a name and observable target.");
    }
    if (input.objectives.some((item) => !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1)) {
      throw new Error("Every objective weight must be between 0 and 1.");
    }
    const objectiveNames = input.objectives.map((item) => item.name.trim().toLocaleLowerCase());
    if (new Set(objectiveNames).size !== objectiveNames.length) {
      throw new Error("Objective names must be unique because observations are scored by objective.");
    }
    const weight = input.objectives.reduce((sum, item) => sum + item.weight, 0);
    if (Math.abs(weight - 1) > 0.001) throw new Error("Objective weights must add up to 1.");
    if (input.worldModel.length === 0) throw new Error("At least one falsifiable world-model claim is required.");
    for (const claim of input.worldModel) {
      if (!claim.statement.trim() || !claim.falsifier.trim()) {
        throw new Error("Every world-model claim needs a statement and falsifier.");
      }
      assertFiniteRange(claim.confidence, 0, 100, "World-model confidence");
    }
    assertFiniteRange(input.budget.attentionMinutes, 1, 1_000_000, "Attention budget");
    assertFiniteRange(input.budget.modelCostUsd, 0, 1_000_000, "Model-cost budget");
    assertFiniteRange(input.budget.cycleDays, 1, 3650, "Cycle duration");

    const loopId = id("loop");
    const createdAt = now();
    const contract = {
      ...input,
      id: loopId,
      name: input.name.trim(),
      intent: input.intent.trim(),
      objectives: input.objectives.map((item) => ({ ...item, id: id("obj") })),
      worldModel: input.worldModel.map((item) => ({ ...item, id: id("claim") })),
      guardrails: input.guardrails.filter(Boolean),
      createdAt,
    };
    const cycle: LoopCycle = {
      id: id("cycle"),
      number: 1,
      status: "ready",
      startedAt: createdAt,
    };
    const events = [
      event(loopId, 1, "loop.created", contract),
      event(loopId, 2, "cycle.started", cycle),
    ];
    await this.store.append(loopId, 0, events);
    return reduceLoop(events);
  }

  async recordPrior(loopId: string, prior: HumanPrior): Promise<LoopAggregate> {
    const loop = await this.get(loopId);
    assertStatus(loop, "ready", "Recording a prior");
    if (!prior.prediction.trim()) throw new Error("A falsifiable human prediction is required.");
    if (!prior.reasoning.trim()) throw new Error("Reasoning for the human prediction is required.");
    assertFiniteRange(prior.confidence, 0, 100, "Human confidence");
    await this.append(loop, "human.prior_recorded", {
      ...prior,
      confidence: Math.max(0, Math.min(100, Math.round(prior.confidence))),
    });
    return this.get(loopId);
  }

  async requestAdvice(loopId: string): Promise<LoopAggregate> {
    const loop = await this.get(loopId);
    assertStatus(loop, "awaiting_agent", "Requesting Agent advice");
    const advice = await this.agent.generateAdvice({ contract: loop.contract, cycle: getActiveCycle(loop) });
    await this.append(loop, "agent.advice_recorded", normalizeAdvice(advice));
    return this.get(loopId);
  }

  async recordDecision(loopId: string, decision: HumanDecision): Promise<LoopAggregate> {
    const loop = await this.get(loopId);
    assertStatus(loop, "awaiting_human", "Recording a decision");
    if (!decision.choice.trim() || !decision.rationale.trim()) throw new Error("Decision and rationale are required.");
    if (!["yes", "partial", "no"].includes(decision.acceptedAgentAdvice)) {
      throw new Error("Agent-advice acceptance must be yes, partial, or no.");
    }
    await this.append(loop, "human.decision_recorded", decision);
    return this.get(loopId);
  }

  async recordObservation(loopId: string, observation: Observation): Promise<LoopAggregate> {
    const loop = await this.get(loopId);
    assertStatus(loop, "running", "Recording an observation");
    if (!observation.outcome.trim() || !observation.evidence.trim()) throw new Error("Outcome and evidence are required.");
    assertFiniteRange(observation.costMinutes, 0, loop.contract.budget.attentionMinutes, "Observed attention cost");
    assertFiniteRange(observation.modelCostUsd, 0, loop.contract.budget.modelCostUsd, "Observed model cost");
    for (const objective of loop.contract.objectives) {
      const score = observation.objectiveScores[objective.name];
      if (score === undefined) throw new Error(`Missing score for objective ${objective.name}.`);
      assertFiniteRange(score, 0, 100, `Score for ${objective.name}`);
    }
    await this.append(loop, "observation.recorded", observation);
    return this.get(loopId);
  }

  async completeReview(loopId: string, revision: Revision): Promise<LoopAggregate> {
    const loop = await this.get(loopId);
    assertStatus(loop, "reviewing", "Completing a review");
    if (!revision.modelUpdate.trim() || !revision.strategyUpdate.trim()) {
      throw new Error("Model and strategy updates are required.");
    }
    assertFiniteRange(revision.confidenceDelta, -100, 100, "Confidence delta");

    const events: LoopEvent[] = [event(loop.id, loop.version + 1, "review.completed", revision)];
    if (revision.startNextCycle) {
      events.push(
        event(loop.id, loop.version + 2, "cycle.started", {
          id: id("cycle"),
          number: loop.cycles.length + 1,
          status: "ready",
          startedAt: now(),
        } satisfies LoopCycle),
      );
    }
    await this.store.append(loop.id, loop.version, events);
    return this.get(loop.id);
  }

  async export(loopId: string): Promise<{ schemaVersion: 1; exportedAt: string; events: LoopEvent[] }> {
    return { schemaVersion: 1, exportedAt: now(), events: await this.store.read(loopId) };
  }

  private async append<T>(loop: LoopAggregate, type: LoopEvent<T>["type"], payload: T): Promise<void> {
    await this.store.append(loop.id, loop.version, [event(loop.id, loop.version + 1, type, payload)]);
  }
}

function normalizeAdvice(advice: AgentAdvice): AgentAdvice {
  const required = [
    advice.recommendation,
    advice.prediction,
    advice.strongestCounterargument,
    advice.experiment,
  ];
  if (required.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("Agent advice is missing a required explanation.");
  }
  assertFiniteRange(advice.confidence, 0, 100, "Agent confidence");

  return {
    recommendation: advice.recommendation.trim(),
    prediction: advice.prediction.trim(),
    confidence: Math.max(0, Math.min(100, Math.round(advice.confidence))),
    strongestCounterargument: advice.strongestCounterargument.trim(),
    experiment: advice.experiment.trim(),
    evidenceNeeded: advice.evidenceNeeded.map((item) => item.trim()).filter(Boolean),
  };
}
