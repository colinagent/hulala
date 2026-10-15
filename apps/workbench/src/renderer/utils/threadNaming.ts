const DEFAULT_THREAD_TITLE = 'Untitled Chat';
const MAX_TITLE_LENGTH = 60;
const MAX_THREAD_ID_LENGTH = 64;

const COMMAND_PREFIX_RE = /^\/[a-z0-9_-]+\s*/i;
const MARKDOWN_NOISE_RE = /^[#>*`\-\[\]\(\)\s]+/;

type DeriveThreadTitleParams = {
  manualTitle?: string | null;
  userText?: string | null;
};

export function deriveThreadTitle(params: DeriveThreadTitleParams): string {
  const manual = normalizeCandidate(params.manualTitle || '');
  if (manual) return smartTruncate(manual, MAX_TITLE_LENGTH);

  const firstUserLine = extractFirstUserLine(params.userText || '');
  if (firstUserLine) return smartTruncate(firstUserLine, MAX_TITLE_LENGTH);

  return DEFAULT_THREAD_TITLE;
}

export function slugifyThreadId(title: string): string {
  const base = (title || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/\.+/g, '.')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^\.|\.$/g, '')
    .replace(/\.\./g, '.');
  const candidate = base.slice(0, MAX_THREAD_ID_LENGTH).replace(/^-+|-+$/g, '');
  return candidate || 'untitled-chat';
}

export function ensureUniqueThreadId(baseId: string, existingIds: Set<string>): string {
  const normalized = normalizeThreadId(baseId);
  if (!existingIds.has(normalized)) return normalized;
  for (let i = 2; i < 10000; i += 1) {
    const suffix = `-${i}`;
    const head = normalized.slice(0, Math.max(1, MAX_THREAD_ID_LENGTH - suffix.length));
    const next = `${head}${suffix}`.replace(/^-+|-+$/g, '');
    if (!existingIds.has(next)) return next;
  }
  return `${normalized.slice(0, 54)}-${Date.now().toString(36)}`.replace(/^-+|-+$/g, '');
}

export function fileNameToThreadId(name: string): string | null {
  const trimmed = (name || '').trim();
  if (!trimmed.endsWith('.md')) return null;
  const stem = trimmed.slice(0, -3).trim();
  return stem || null;
}

export function isAutoThreadId(input: string): boolean {
  const id = (input || '').trim().toLowerCase();
  if (!id) return false;
  return /^untitled-(?:chat|session)(?:-\d+)?$/.test(id) || /^thread-\d{8,}$/.test(id);
}

function normalizeThreadId(input: string): string {
  const cleaned = slugifyThreadId(input);
  return cleaned.slice(0, MAX_THREAD_ID_LENGTH);
}

function extractFirstUserLine(input: string): string {
  const lines = (input || '').split('\n');
  for (const line of lines) {
    const normalized = normalizeCandidate(line);
    if (normalized) return normalized;
  }
  return '';
}

function normalizeCandidate(input: string): string {
  return (input || '')
    .trim()
    .replace(COMMAND_PREFIX_RE, '')
    .replace(MARKDOWN_NOISE_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function smartTruncate(input: string, max: number): string {
  const text = (input || '').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const breakpoints = [' ', ',', '.', ';', ':', '!', '?', '-', '，', '。', '；', '：', '！', '？'];
  let idx = -1;
  for (const token of breakpoints) {
    const pos = cut.lastIndexOf(token);
    if (pos > idx) idx = pos;
  }
  const head = (idx >= Math.floor(max * 0.6) ? cut.slice(0, idx) : cut).trim();
  return `${head}...`;
}
