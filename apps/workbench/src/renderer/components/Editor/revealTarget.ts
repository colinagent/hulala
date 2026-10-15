import type { EditorRevealTarget } from '../../store/appStore';

export function revealTargetToPos(content: string, reveal: EditorRevealTarget | null | undefined): number {
  if (!reveal || !Number.isFinite(reveal.line)) {
    return 0;
  }

  const normalizedLine = Math.max(1, Math.floor(reveal.line));
  const normalizedColumn = Math.max(1, Math.floor(reveal.column ?? 1));
  const lines = content.split('\n');
  if (lines.length === 0) {
    return 0;
  }

  const lineIndex = Math.min(normalizedLine, lines.length) - 1;
  let pos = 0;
  for (let i = 0; i < lineIndex; i += 1) {
    pos += lines[i].length;
    if (i < lines.length - 1) {
      pos += 1;
    }
  }

  const lineText = lines[lineIndex] || '';
  const columnOffset = Math.min(normalizedColumn - 1, lineText.length);
  return pos + columnOffset;
}
