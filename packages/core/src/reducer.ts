import type {
  AgentAdvice,
  HumanDecision,
  HumanPrior,
  LoopAggregate,
  LoopContract,
  LoopCycle,
  LoopEvent,
  Observation,
  Revision,
} from "./domain";

function activeCycle(loop: LoopAggregate): LoopCycle {
  const cycle = loop.cycles.at(-1);
  if (!cycle) throw new Error("Loop has no active cycle.");
  return cycle;
}

export function reduceLoop(events: LoopEvent[]): LoopAggregate {
  if (events.length === 0) throw new Error("Cannot reduce an empty event stream.");

  let aggregate: LoopAggregate | undefined;

  for (const event of events) {
    if (event.type === "loop.created") {
      if (aggregate) throw new Error("Loop can only be created once.");
      const contract = event.payload as LoopContract;
      aggregate = {
        id: event.loopId,
        version: event.version,
        status: "ready",
        contract,
        cycles: [],
        createdAt: event.occurredAt,
        updatedAt: event.occurredAt,
      };
      continue;
    }

    if (!aggregate) throw new Error("First event must be loop.created.");
    aggregate.version = event.version;
    aggregate.updatedAt = event.occurredAt;

    switch (event.type) {
      case "cycle.started": {
        aggregate.cycles.push(event.payload as LoopCycle);
        aggregate.status = "ready";
        break;
      }
      case "human.prior_recorded": {
        const cycle = activeCycle(aggregate);
        cycle.humanPrior = event.payload as HumanPrior;
        cycle.status = "awaiting_agent";
        aggregate.status = "awaiting_agent";
        break;
      }
      case "agent.advice_recorded": {
        const cycle = activeCycle(aggregate);
        cycle.agentAdvice = event.payload as AgentAdvice;
        cycle.status = "awaiting_human";
        aggregate.status = "awaiting_human";
        break;
      }
      case "human.decision_recorded": {
        const cycle = activeCycle(aggregate);
        cycle.decision = event.payload as HumanDecision;
        cycle.status = "running";
        aggregate.status = "running";
        break;
      }
      case "observation.recorded": {
        const cycle = activeCycle(aggregate);
        cycle.observation = event.payload as Observation;
        cycle.status = "reviewing";
        aggregate.status = "reviewing";
        break;
      }
      case "review.completed": {
        const cycle = activeCycle(aggregate);
        const revision = event.payload as Revision;
        cycle.revision = revision;
        cycle.status = "completed";
        cycle.completedAt = event.occurredAt;
        aggregate.status = "completed";
        break;
      }
      default: {
        const exhaustive: never = event.type;
        throw new Error(`Unsupported event: ${exhaustive}`);
      }
    }
  }

  if (!aggregate) throw new Error("Loop was not created.");
  return aggregate;
}

export function getActiveCycle(loop: LoopAggregate): LoopCycle {
  return activeCycle(loop);
}
