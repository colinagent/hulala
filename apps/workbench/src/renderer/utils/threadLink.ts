export const THREAD_LINK_SCHEME = 'thread:';

const LEGACY_THREAD_ID_RE = /^thread-\S+$/;
const DATE_THREAD_ID_RE = /^\d{8}T\d{6}Z-[0-9a-fA-F]{6}$/;

export type ParsedThreadLink = {
  threadID: string;
};

export function isValidThreadID(value: string | null | undefined): boolean {
  const normalized = (value || '').trim();
  return LEGACY_THREAD_ID_RE.test(normalized) || DATE_THREAD_ID_RE.test(normalized);
}

export function buildThreadLinkTarget(threadID: string | null | undefined): string {
  const normalized = (threadID || '').trim();
  return isValidThreadID(normalized) ? `${THREAD_LINK_SCHEME}${normalized}` : '';
}

export function parseThreadLinkTarget(raw: string | null | undefined): ParsedThreadLink | null {
  const trimmed = (raw || '').trim();
  if (!trimmed.startsWith(THREAD_LINK_SCHEME)) {
    return null;
  }
  const threadID = trimmed.slice(THREAD_LINK_SCHEME.length).trim();
  if (!isValidThreadID(threadID)) {
    return null;
  }
  return { threadID };
}
