export type MarkdownTagRange = {
  from: number;
  to: number;
  label: string;
};

const TAG_BOUNDARY_CHARACTERS = new Set([
  '(', '[', '{', '"', "'", '，', '。', '！', '？', '、', '；', '：',
]);

function overlapsExistingRange(
  from: number,
  to: number,
  existingRanges: readonly { from: number; to: number }[]
): boolean {
  return existingRanges.some((range) => from < range.to && to > range.from);
}

/**
 * Finds Obsidian-style inline tags. A tag must begin at the start of text or
 * after whitespace/punctuation, which keeps Markdown headings (`# Heading`)
 * and fragments inside words from becoming tag pills.
 */
export function findMarkdownTagRanges(
  text: string,
  existingRanges: readonly { from: number; to: number }[] = []
): MarkdownTagRange[] {
  const ranges: MarkdownTagRange[] = [];
  const matcher = /#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    const previousCharacter = text[match.index - 1];
    const hasTagBoundary = !previousCharacter
      || /\s/u.test(previousCharacter)
      || TAG_BOUNDARY_CHARACTERS.has(previousCharacter);
    if (!hasTagBoundary) {
      continue;
    }
    const label = match[1];
    const from = match.index;
    const to = from + label.length + 1;
    if (!overlapsExistingRange(from, to, existingRanges)) {
      ranges.push({ from, to, label });
    }
  }

  return ranges;
}
