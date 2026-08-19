import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunContext } from "@hulala/core";
import { DshAgentDriver, parseAdvice } from "./dsh-agent-driver";

test("parseAdvice reads a JSON object out of model prose", () => {
  const advice = parseAdvice(`Here you go:
{
  "recommendation": "run a one-week paper trade",
  "prediction": "drawdown stays under 8% by Friday",
  "confidence": 61,
  "strongestCounterargument": "the regime filter is still untested",
  "experiment": "paper-trade the new stop for five sessions",
  "evidenceNeeded": ["session PnL", "max drawdown"]
}
thanks`);

  assert.equal(advice.recommendation, "run a one-week paper trade");
  assert.equal(advice.confidence, 61);
  assert.deepEqual(advice.evidenceNeeded, ["session PnL", "max drawdown"]);
});

test("parseAdvice rejects a payload that is missing required fields", () => {
  assert.throws(() => parseAdvice('{"recommendation":"x"}'), /required schema/);
});

test("missing DEEPSEEK_API_KEY is a clear local configuration error", async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const driver = new DshAgentDriver();
    const status = await driver.status();
    assert.equal(status.configured, false);
    assert.match(status.message, /DEEPSEEK_API_KEY/);
    await assert.rejects(driver.generateAdvice({} as AgentRunContext), /DEEPSEEK_API_KEY/);
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});
