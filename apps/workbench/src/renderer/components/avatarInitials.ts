const FALLBACK_PALETTE = [
  '#4B7BE5',
  '#5A8DEE',
  '#6F56D9',
  '#8A5CD7',
  '#C05C7E',
  '#E26A6A',
  '#E58F4B',
  '#F0B429',
  '#3AAFA9',
  '#2F9E82',
  '#2D6A4F',
  '#4C6EF5',
];

function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function isCJK(char: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(char);
}

export function buildInitials(name: string): string {
  const t = (name || '').trim();
  if (!t) return 'U';
  const noSpace = t.replace(/\s+/g, '');
  if (noSpace && isCJK(noSpace[0])) {
    return noSpace.slice(-2);
  }
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  }
  return noSpace.slice(0, 2).toUpperCase();
}

export function initialsBackgroundColor(name: string): string {
  return FALLBACK_PALETTE[fnv1a(name || 'user') % FALLBACK_PALETTE.length];
}
