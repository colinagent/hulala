export type PropertyKind =
  | 'text'
  | 'tags'
  | 'list'
  | 'object'
  | 'object-list'
  | 'link-thread'
  | 'run'
  | 'boolean'
  | 'number'
  | 'complex';

export type FrontmatterObjectEntry = {
  key: string;
  value: unknown;
};

function isScalarListItem(value: unknown): boolean {
  return (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  );
}

export function isPlainFrontmatterObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function inferPropertyKind(key: string, value: unknown): PropertyKind {
  const lowerKey = key.trim().toLowerCase();
  if (lowerKey === 'thread' || lowerKey === 'parent_thread') {
    return 'link-thread';
  }
  if (lowerKey === 'tags') {
    return 'tags';
  }
  if (lowerKey === 'run') {
    return 'run';
  }
  if (value === null || value === undefined) {
    return 'text';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'string') {
    return 'text';
  }
  if (Array.isArray(value)) {
    if (value.every(isScalarListItem)) {
      return 'list';
    }
    if (value.every(isPlainFrontmatterObject)) {
      return 'object-list';
    }
    return 'complex';
  }
  if (isPlainFrontmatterObject(value)) {
    return 'object';
  }
  if (typeof value === 'object') {
    return 'complex';
  }
  return 'text';
}

export function normalizeObjectEntries(value: unknown): FrontmatterObjectEntry[] {
  if (!isPlainFrontmatterObject(value)) {
    return [];
  }
  return Object.entries(value).map(([key, item]) => ({ key, value: item }));
}

export function patchObjectEntry(
  value: unknown,
  key: string,
  nextValue: unknown,
): Record<string, unknown> {
  const base = { ...(isPlainFrontmatterObject(value) ? value : {}) };
  if (nextValue === undefined) {
    delete base[key];
    return base;
  }
  base[key] = nextValue;
  return base;
}

function stripTagTokenQuotes(token: string): string {
  const trimmed = token.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function splitTagTokens(text: string): string[] {
  const quote = text[0];
  const normalized = (quote === '"' || quote === "'")
    && text.endsWith(quote) && !text.slice(1, -1).includes(quote)
    ? text.slice(1, -1) : text;
  return normalized
    .split(',')
    .map(stripTagTokenQuotes)
    .filter(Boolean);
}

export function normalizeTagsValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const text = String(item).trim();
      if (!text) {
        return [];
      }
      return text.includes(',') ? splitTagTokens(text) : [stripTagTokenQuotes(text)];
    });
  }
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim();
    if (text.includes(',')) {
      return splitTagTokens(text);
    }
    const single = stripTagTokenQuotes(text);
    return single ? [single] : [];
  }
  return [];
}

export function normalizeListValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function needsRunCommandQuoting(token: string): boolean {
  return /[\s"'\\]/.test(token);
}

function escapeRunCommandToken(token: string): string {
  if (!needsRunCommandQuoting(token)) {
    return token;
  }
  return `"${token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function formatRunCommand(argv: string[]): string {
  return argv.map((item) => escapeRunCommandToken(String(item))).join(' ');
}

export function parseRunCommand(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === '"') {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function summarizeComplexValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= 96) {
      return serialized;
    }
    return `${serialized.slice(0, 93)}...`;
  } catch {
    return String(value);
  }
}

export function scalarToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  return summarizeComplexValue(value);
}

export type RunEndpointMode = 'command' | 'url';

function hasNonEmptyRunFieldValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isPlainFrontmatterObject(value)) {
    return normalizeObjectEntries(value).some((entry) => hasNonEmptyRunFieldValue(entry.value));
  }
  return true;
}

export function inferRunEndpointMode(value: unknown): RunEndpointMode {
  if (!isPlainFrontmatterObject(value)) {
    return 'command';
  }
  if ('url' in value || 'header' in value) {
    return 'url';
  }
  return 'command';
}

export function pruneRunObject(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainFrontmatterObject(value)) {
    return undefined;
  }
  const next: Record<string, unknown> = {};
  for (const entry of normalizeObjectEntries(value)) {
    if (entry.key === 'url' && typeof entry.value === 'string') {
      next.url = entry.value;
      continue;
    }
    if (entry.value === undefined) {
      continue;
    }
    if (isPlainFrontmatterObject(entry.value)) {
      const pruned = pruneRunObject(entry.value);
      if (pruned && Object.keys(pruned).length > 0) {
        next[entry.key] = pruned;
      }
      continue;
    }
    if (hasNonEmptyRunFieldValue(entry.value)) {
      next[entry.key] = entry.value;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function switchRunEndpointMode(value: unknown, mode: RunEndpointMode): unknown {
  const next = { ...(isPlainFrontmatterObject(value) ? value : {}) };
  if (mode === 'command') {
    delete next.url;
    delete next.header;
  } else {
    delete next.command;
    if (!('url' in next)) {
      next.url = '';
    }
  }
  return pruneRunObject(next);
}
