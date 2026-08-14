import type { AgentRunContext } from "./domain";

export function buildAdvicePrompt({ contract }: AgentRunContext): string {
  const objectives = contract.objectives
    .map((item) => `- ${item.name} (weight ${item.weight}): ${item.target}${item.floor ? `; floor: ${item.floor}` : ""}`)
    .join("\n");
  const models = contract.worldModel
    .map((claim) => `- ${claim.statement} (confidence ${claim.confidence}%). Falsified by: ${claim.falsifier}`)
    .join("\n");

  return `You are the Agent participant in a human-AI decision loop.
Your job is to improve the user's world model, not to maximize agreement.

LOOP INTENT
${contract.intent}

OBJECTIVE FUNCTION
${objectives}

CURRENT WORLD MODEL
${models}

BUDGET
- Human attention: ${contract.budget.attentionMinutes} minutes
- Energy: ${contract.budget.energyLevel}
- Model cost ceiling: $${contract.budget.modelCostUsd}
- Cycle duration: ${contract.budget.cycleDays} days

GUARDRAILS
${contract.guardrails.map((item) => `- ${item}`).join("\n")}

INDEPENDENCE RULE
The human participant has already recorded a prior prediction. It is deliberately hidden from you. Form your own prediction from the contract and world model so the system can measure real disagreement instead of mutual anchoring.

Return one JSON object only, with exactly these keys:
{
  "recommendation": "specific next action",
  "prediction": "observable prediction with scope and deadline",
  "confidence": 0,
  "strongestCounterargument": "best reason this advice could be wrong",
  "experiment": "small reversible experiment within budget",
  "evidenceNeeded": ["evidence item"]
}

Confidence must be an integer from 0 to 100. Make the smallest reversible experiment that can distinguish between competing explanations.`;
}
