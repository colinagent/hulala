export type ModelReasoningControl = 'level' | 'toggle';

type ModelReasoningInput = {
  reasoning?: boolean | null;
  reasoningLevels?: string[] | null;
  reasoningControl?: unknown;
};

export function normalizeModelReasoningControl(value: unknown): ModelReasoningControl | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'level' || normalized === 'toggle') {
    return normalized;
  }
  return undefined;
}

export function resolveModelReasoningControl(input: ModelReasoningInput): ModelReasoningControl | undefined {
  const explicit = normalizeModelReasoningControl(input.reasoningControl);
  if (explicit) {
    return explicit;
  }
  if (Array.isArray(input.reasoningLevels) && input.reasoningLevels.length > 0) {
    return 'level';
  }
  if (input.reasoning === true) {
    return 'toggle';
  }
  return undefined;
}
