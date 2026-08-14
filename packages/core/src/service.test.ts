import assert from "node:assert/strict";
import test from "node:test";
import type { AgentDriver, EventStore, LoopEvent } from "./domain";
import { buildAdvicePrompt } from "./prompt";
import { LoopService } from "./service";

class MemoryStore implements EventStore {
  private readonly streams = new Map<string, LoopEvent[]>();

  async listLoopIds(): Promise<string[]> {
    return [...this.streams.keys()];
  }

  async read(loopId: string): Promise<LoopEvent[]> {
    return structuredClone(this.streams.get(loopId) ?? []);
  }

  async append(loopId: string, expectedVersion: number, events: LoopEvent[]): Promise<void> {
    const current = this.streams.get(loopId) ?? [];
    assert.equal(current.length, expectedVersion, "optimistic concurrency version");
    this.streams.set(loopId, [...current, ...structuredClone(events)]);
  }
}

const agent: AgentDriver = {
  async generateAdvice() {
    return {
      recommendation: "Publish one short explanation with a concrete example.",
      prediction: "A concrete example will lift saves by at least 10% this week.",
      confidence: 62,
      strongestCounterargument: "The audience may care more about novelty than clarity.",
      experiment: "Create two otherwise similar drafts and compare blind preference.",
      evidenceNeeded: ["Blind preference", "Save rate after 48 hours"],
    };
  },
};

test("runs a complete human-Agent feedback cycle and starts the next cycle", async () => {
  const service = new LoopService(new MemoryStore(), agent);
  const created = await service.create({
    name: "Content signal",
    intent: "Find a repeatable way to explain difficult ideas clearly.",
    horizon: "4 weeks",
    objectives: [
      { name: "Audience value", weight: 0.7, target: "Increase qualified saves" },
      { name: "Sustainability", weight: 0.3, target: "Stay under two hours per post", floor: "No daily publishing" },
    ],
    worldModel: [{ statement: "Concrete examples drive saves.", confidence: 55, falsifier: "No lift across three paired posts" }],
    budget: { attentionMinutes: 120, energyLevel: "medium", modelCostUsd: 2, cycleDays: 7 },
    guardrails: ["No automatic publishing"],
  });

  await service.recordPrior(created.id, {
    prediction: "A specific example will improve saves.",
    confidence: 58,
    reasoning: "My strongest past posts used examples.",
  });
  const advised = await service.requestAdvice(created.id);
  assert.equal(advised.status, "awaiting_human");
  assert.equal(advised.cycles[0]?.agentAdvice?.confidence, 62);

  await service.recordDecision(created.id, {
    choice: "Run the paired-draft experiment.",
    rationale: "It is reversible and fits the budget.",
    acceptedAgentAdvice: "yes",
  });
  await service.recordObservation(created.id, {
    outcome: "Example draft won 7 of 10 blind votes.",
    evidence: "Blind preference sheet and 48-hour analytics.",
    objectiveScores: { "Audience value": 78, Sustainability: 90 },
    costMinutes: 83,
    modelCostUsd: 0.42,
  });
  const reviewed = await service.completeReview(created.id, {
    modelUpdate: "Concrete examples probably help, but the estimate remains noisy.",
    strategyUpdate: "Repeat with a different topic and pre-register the save-rate threshold.",
    confidenceDelta: 8,
    startNextCycle: true,
  });

  assert.equal(reviewed.status, "ready");
  assert.equal(reviewed.cycles.length, 2);
  assert.equal(reviewed.cycles[0]?.status, "completed");
  assert.equal((await service.export(created.id)).events.length, 8);
});

test("enforces objective weights and cycle budget", async () => {
  const service = new LoopService(new MemoryStore(), agent);
  await assert.rejects(
    service.create({
      name: "Invalid",
      intent: "Invalid objective weighting",
      horizon: "1 week",
      objectives: [{ name: "Only", weight: 0.5, target: "Something" }],
      worldModel: [],
      budget: { attentionMinutes: 30, energyLevel: "low", modelCostUsd: 1, cycleDays: 7 },
      guardrails: [],
    }),
    /weights must add up to 1/,
  );
});

test("hides the human prior from the Agent prompt", () => {
  const prompt = buildAdvicePrompt({
    contract: {
      id: "loop_test",
      name: "Independent judgment",
      intent: "Compare two explanations.",
      horizon: "1 week",
      objectives: [{ id: "obj_test", name: "Learning", weight: 1, target: "Resolve uncertainty" }],
      worldModel: [{ id: "claim_test", statement: "Examples help.", confidence: 50, falsifier: "No measured lift" }],
      budget: { attentionMinutes: 30, energyLevel: "low", modelCostUsd: 1, cycleDays: 7 },
      guardrails: ["No publishing"],
      createdAt: "2026-08-13T00:00:00.000Z",
    },
    cycle: {
      id: "cycle_test",
      number: 1,
      status: "awaiting_agent",
      startedAt: "2026-08-13T00:00:00.000Z",
      humanPrior: {
        prediction: "SECRET HUMAN PREDICTION",
        confidence: 99,
        reasoning: "SECRET HUMAN REASONING",
      },
    },
  });

  assert.match(prompt, /deliberately hidden/i);
  assert.doesNotMatch(prompt, /SECRET HUMAN/);
});
