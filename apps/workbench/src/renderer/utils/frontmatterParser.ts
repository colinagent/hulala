import { isValidThreadID } from './threadLink';

export function parseFrontmatterStringValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const decoded = JSON.parse(trimmed);
      return typeof decoded === 'string' ? decoded.trim() : trimmed;
    } catch {
      return trimmed.slice(1, -1).trim();
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).trim();
  return trimmed;
}

export function parseThreadFrontmatterValue(raw: string | null | undefined): string {
  const value = parseFrontmatterStringValue(raw || '');
  return isValidThreadID(value) ? value : '';
}
