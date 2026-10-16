export type CjkAsteriskEmphasisRange = {
  from: number;
  to: number;
  markerLength: 1 | 2;
};

const CJK_OPENING_PAIRED_PUNCTUATION = new Set([
  '“',
  '‘',
  '「',
  '『',
  '（',
  '《',
  '【',
]);

const CJK_CLOSING_PAIRED_PUNCTUATION = new Set([
  '”',
  '’',
  '」',
  '』',
  '）',
  '》',
  '】',
]);

function countRepeatedAsterisks(text: string, index: number): number {
  let cursor = index;
  while (text[cursor] === '*') {
    cursor += 1;
  }
  return cursor - index;
}

function overlapsExistingRange(
  from: number,
  to: number,
  existingRanges: readonly { from: number; to: number }[]
): boolean {
  return existingRanges.some((range) => from < range.to && to > range.from);
}

export function findCjkAsteriskEmphasisRanges(
  text: string,
  existingRanges: readonly { from: number; to: number }[] = []
): CjkAsteriskEmphasisRange[] {
  const ranges: CjkAsteriskEmphasisRange[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '*') {
      continue;
    }

    const markerLength = countRepeatedAsterisks(text, index);
    if (markerLength !== 1 && markerLength !== 2) {
      index += Math.max(0, markerLength - 1);
      continue;
    }

    const afterOpen = text[index + markerLength] || '';
    if (!CJK_OPENING_PAIRED_PUNCTUATION.has(afterOpen)) {
      index += markerLength - 1;
      continue;
    }

    let closeIndex = index + markerLength;
    let sawClosingPairedPunctuation = false;

    while (closeIndex < text.length) {
      if (CJK_CLOSING_PAIRED_PUNCTUATION.has(text[closeIndex])) {
        sawClosingPairedPunctuation = true;
      }

      if (
        sawClosingPairedPunctuation &&
        text[closeIndex] === '*' &&
        text.slice(closeIndex, closeIndex + markerLength) === '*'.repeat(markerLength)
      ) {
        const from = index;
        const to = closeIndex + markerLength;
        if (!overlapsExistingRange(from, to, existingRanges)) {
          ranges.push({
            from,
            to,
            markerLength,
          });
        }
        index = to - 1;
        break;
      }

      closeIndex += 1;
    }
  }

  return ranges;
}
