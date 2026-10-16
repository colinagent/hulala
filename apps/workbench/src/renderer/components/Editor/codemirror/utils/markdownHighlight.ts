export type MarkdownHighlightRange = {
  from: number;
  to: number;
};

function overlapsExistingRange(
  from: number,
  to: number,
  existingRanges: readonly { from: number; to: number }[]
): boolean {
  return existingRanges.some((range) => from < range.to && to > range.from);
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isExactHighlightMarker(text: string, index: number): boolean {
  return (
    text.slice(index, index + 2) === '==' &&
    text[index - 1] !== '=' &&
    text[index + 2] !== '=' &&
    !isEscaped(text, index)
  );
}

function isWhitespace(value: string): boolean {
  return /\s/.test(value);
}

function canOpenHighlightMarker(text: string, index: number): boolean {
  const after = text[index + 2] || '';
  return isExactHighlightMarker(text, index) && after.length > 0 && !isWhitespace(after);
}

function canCloseHighlightMarker(text: string, index: number): boolean {
  const before = text[index - 1] || '';
  return isExactHighlightMarker(text, index) && before.length > 0 && !isWhitespace(before);
}

export function findMarkdownHighlightRanges(
  text: string,
  existingRanges: readonly { from: number; to: number }[] = []
): MarkdownHighlightRange[] {
  const ranges: MarkdownHighlightRange[] = [];

  for (let index = 0; index < text.length - 1; index += 1) {
    if (!canOpenHighlightMarker(text, index)) {
      continue;
    }
    if (overlapsExistingRange(index, index + 2, existingRanges)) {
      index += 1;
      continue;
    }

    let closeIndex = index + 2;
    while (closeIndex < text.length - 1) {
      if (!canCloseHighlightMarker(text, closeIndex)) {
        closeIndex += 1;
        continue;
      }
      const content = text.slice(index + 2, closeIndex);
      const to = closeIndex + 2;
      if (
        content.trim().length > 0 &&
        !overlapsExistingRange(closeIndex, to, existingRanges) &&
        !overlapsExistingRange(index, to, existingRanges)
      ) {
        ranges.push({ from: index, to });
        index = to - 1;
      } else {
        index += 1;
      }
      break;
    }
  }

  return ranges;
}
