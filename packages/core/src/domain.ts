export type LoopStatus =
  | "ready"
  | "awaiting_agent"
  | "awaiting_human"
  | "running"
  | "reviewing"
  | "completed";

export type CycleStatus = LoopStatus;

export interface ObjectiveDimension {
  id: string;
  name: string;
  weight: number;
  target: string;
  floor?: string;
}

export interface WorldModelClaim {
  id: string;
  statement: string;
  confidence: number;
  falsifier: string;
}

export interface LoopBudget {
  attentionMinutes: number;
  energyLevel: "low" | "medium" | "high";
  modelCostUsd: number;
  cycleDays: number;
}

export interface LoopContract {
  id: string;
  name: string;
  intent: string;
  horizon: string;
  objectives: ObjectiveDimension[];
  worldModel: WorldModelClaim[];
  budget: LoopBudget;
  guardrails: string[];
  createdAt: string;
}

export interface HumanPrior {
  prediction: string;
  confidence: number;
  reasoning: string;
}

export interface AgentAdvice {
  recommendation: string;
  prediction: string;
  confidence: number;
  strongestCounterargument: string;
  experiment: string;
  evidenceNeeded: string[];
}

export interface HumanDecision {
  choice: string;
  rationale: string;
  acceptedAgentAdvice: "yes" | "partial" | "no";
}

export interface Observation {
  outcome: string;
  evidence: string;
  objectiveScores: Record<string, number>;
  costMinutes: number;
  modelCostUsd: number;
}

export interface Revision {
  modelUpdate: string;
  strategyUpdate: string;
  confidenceDelta: number;
  startNextCycle: boolean;
}

export interface LoopCycle {
  id: string;
  number: number;
  status: CycleStatus;
  startedAt: string;
  completedAt?: string;
  humanPrior?: HumanPrior;
  agentAdvice?: AgentAdvice;
  decision?: HumanDecision;
  observation?: Observation;
  revision?: Revision;
}

export interface LoopAggregate {
  id: string;
  version: number;
  status: LoopStatus;
  contract: LoopContract;
  cycles: LoopCycle[];
  createdAt: string;
  updatedAt: string;
}

export type LoopEventType =
  | "loop.created"
  | "cycle.started"
  | "human.prior_recorded"
  | "agent.advice_recorded"
  | "human.decision_recorded"
  | "observation.recorded"
  | "review.completed";

export interface LoopEvent<T = unknown> {
  id: string;
  loopId: string;
  version: number;
  type: LoopEventType;
  occurredAt: string;
  payload: T;
}

export interface CreateLoopInput {
  name: string;
  intent: string;
  horizon: string;
  objectives: Omit<ObjectiveDimension, "id">[];
  worldModel: Omit<WorldModelClaim, "id">[];
  budget: LoopBudget;
  guardrails: string[];
}

export interface AgentRunContext {
  contract: LoopContract;
  cycle: LoopCycle;
}

export interface AgentDriver {
  generateAdvice(context: AgentRunContext): Promise<AgentAdvice>;
}

export interface EventStore {
  listLoopIds(): Promise<string[]>;
  read(loopId: string): Promise<LoopEvent[]>;
  append(loopId: string, expectedVersion: number, events: LoopEvent[]): Promise<void>;
}
