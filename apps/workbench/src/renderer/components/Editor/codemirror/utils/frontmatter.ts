import { EditorState } from '@codemirror/state';

export const FRONTMATTER_SCAN_MAX_LINES = 100;

export type FrontmatterInfo = { from: number; to: number; endLineNumber: number };

function parseFrontmatterString(value: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function getFrontmatterInfo(state: EditorState): FrontmatterInfo | null {
  const doc = state.doc;
  if (doc.lines < 2) return null;
  const firstLine = doc.line(1);
  if (firstLine.text.trim() !== '---') return null;

  const maxLine = Math.min(doc.lines, FRONTMATTER_SCAN_MAX_LINES);
  for (let i = 2; i <= maxLine; i++) {
    const line = doc.line(i);
    const trimmed = line.text.trim();
    if (trimmed === '---' || trimmed === '...') {
      return { from: firstLine.from, to: line.to, endLineNumber: i };
    }
  }
  return null;
}

export function getFrontmatterValue(state: EditorState, key: string): string | null {
  const frontmatter = getFrontmatterInfo(state);
  if (!frontmatter) return null;

  const wantedKey = (key || '').trim().toLowerCase();
  if (!wantedKey) return null;

  for (let lineNumber = 2; lineNumber < frontmatter.endLineNumber; lineNumber += 1) {
    const line = state.doc.line(lineNumber).text;
    const split = line.indexOf(':');
    if (split <= 0) continue;
    const currentKey = line.slice(0, split).trim().toLowerCase();
    if (currentKey !== wantedKey) continue;
    return parseFrontmatterString(line.slice(split + 1));
  }

  return null;
}
