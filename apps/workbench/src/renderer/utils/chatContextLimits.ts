export const CHAT_SELECTION_MAX_LINES = 300;
export const CHAT_SELECTION_MAX_BYTES = 32 * 1024;

export type LimitedChatContext = {
  text: string;
  truncated: boolean;
};

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

function sliceEndByBytes(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) {
    return text;
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (byteLength(text.slice(0, mid)) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low).trimEnd();
}

function sliceStartByBytes(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) {
    return text;
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (byteLength(text.slice(mid)) <= maxBytes) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return text.slice(low).trimStart();
}

export function limitChatSelectionContext(
  input: string,
  options?: { maxLines?: number; maxBytes?: number },
): LimitedChatContext {
  const maxLines = Math.max(1, Math.floor(options?.maxLines ?? CHAT_SELECTION_MAX_LINES));
  const maxBytes = Math.max(256, Math.floor(options?.maxBytes ?? CHAT_SELECTION_MAX_BYTES));
  const normalized = (input || '').replace(/\r\n/g, '\n').trimEnd();
  const lines = normalized.split('\n');
  if (lines.length <= maxLines && byteLength(normalized) <= maxBytes) {
    return { text: normalized, truncated: false };
  }

  const note = lines.length > maxLines
    ? `... truncated ${Math.max(0, lines.length - maxLines)} lines; read the file path above for full context ...`
    : `... truncated to ${Math.floor(maxBytes / 1024)} KiB; read the file path above for full context ...`;
  const headLineCount = Math.max(1, Math.floor((maxLines - 1) / 2));
  const tailLineCount = Math.max(0, maxLines - 1 - headLineCount);
  let head = lines.slice(0, headLineCount).join('\n');
  let tail = tailLineCount > 0 ? lines.slice(-tailLineCount).join('\n') : '';
  let candidate = tail ? `${head}\n${note}\n${tail}` : `${head}\n${note}`;

  if (byteLength(candidate) > maxBytes) {
    const noteBytes = byteLength(note) + 2;
    const available = Math.max(0, maxBytes - noteBytes);
    const headBudget = Math.floor(available / 2);
    const tailBudget = available - headBudget;
    head = sliceEndByBytes(head, headBudget);
    tail = tail ? sliceStartByBytes(tail, tailBudget) : '';
    candidate = tail ? `${head}\n${note}\n${tail}` : `${head}\n${note}`;
  }

  return { text: candidate.trimEnd(), truncated: true };
}
