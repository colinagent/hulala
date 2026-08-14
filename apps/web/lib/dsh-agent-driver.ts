import { Context } from "@loopwithai/cordis";
import { buildAdvicePrompt, type AgentAdvice, type AgentDriver, type AgentRunContext } from "@loopwithai/core";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export interface AgentStatus {
  reachable: boolean;
  configured: boolean;
  apiUrl: string;
  message: string;
}

export class DshAgentDriver implements AgentDriver {
  private readonly apiUrl = (process.env.DEEPSEEK_API_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  private readonly apiKey = process.env.DEEPSEEK_API_KEY;
  private readonly model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

  async status(): Promise<AgentStatus> {
    if (!this.apiKey) {
      return {
        reachable: false,
        configured: false,
        apiUrl: this.apiUrl,
        message: "DEEPSEEK_API_KEY is not configured. Add it to apps/web/.env.local.",
      };
    }

    try {
      const response = await fetch(`${this.apiUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(2500),
        cache: "no-store",
      });
      if (!response.ok) {
        return {
          reachable: false,
          configured: true,
          apiUrl: this.apiUrl,
          message: `DeepSeek returned ${response.status} while checking credentials.`,
        };
      }
      return {
        reachable: true,
        configured: true,
        apiUrl: this.apiUrl,
        message: "Vendored dsh is ready.",
      };
    } catch {
      return {
        reachable: false,
        configured: true,
        apiUrl: this.apiUrl,
        message: "DeepSeek is unreachable. Check DEEPSEEK_API_URL and the network.",
      };
    }
  }

  async generateAdvice(context: AgentRunContext): Promise<AgentAdvice> {
    if (!this.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is missing. Add it to apps/web/.env.local.");
    }

    const ctx = new Context();
    const abort = new AbortController();
    const dispose = ctx.effect(() => () => abort.abort(), "loop.advice.request");

    try {
      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              content: "You are a calibrated collaborator inside Loop. Follow the requested JSON schema exactly.",
            },
            { role: "user", content: buildAdvicePrompt(context) },
          ],
        }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(300_000)]),
        cache: "no-store",
      });

      const body = (await response.json()) as ChatResponse;
      if (!response.ok) throw new Error(body.error?.message ?? `DeepSeek returned ${response.status}.`);
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("dsh returned an empty response.");
      return parseAdvice(content);
    } finally {
      await dispose();
    }
  }
}

export function parseAdvice(content: string): AgentAdvice {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("dsh did not return the required JSON advice object.");

  const parsed = JSON.parse(content.slice(start, end + 1)) as Partial<AgentAdvice>;
  const fields = [
    parsed.recommendation,
    parsed.prediction,
    parsed.strongestCounterargument,
    parsed.experiment,
  ];
  if (fields.some((field) => typeof field !== "string") || typeof parsed.confidence !== "number") {
    throw new Error("dsh advice did not match the required schema.");
  }

  return {
    recommendation: parsed.recommendation!,
    prediction: parsed.prediction!,
    confidence: parsed.confidence,
    strongestCounterargument: parsed.strongestCounterargument!,
    experiment: parsed.experiment!,
    evidenceNeeded: Array.isArray(parsed.evidenceNeeded)
      ? parsed.evidenceNeeded.filter((item): item is string => typeof item === "string")
      : [],
  };
}
