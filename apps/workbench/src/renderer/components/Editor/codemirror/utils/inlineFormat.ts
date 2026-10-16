export type MarkdownInlineFormat = 'bold' | 'italic' | 'strikethrough' | 'highlight' | 'code';

export type InlineFormatSelection = {
  anchor: number;
  head: number;
};

export type InlineFormatResult = {
  text: string;
  anchor: number;
  head: number;
};

const MARKERS: Record<MarkdownInlineFormat, string> = {
  bold: '**',
  italic: '*',
  strikethrough: '~~',
  highlight: '==',
  code: '`',
};

const CLEAR_MARKERS = ['**', '~~', '==', '*', '`'] as const;

function normalizeSelection(selection: InlineFormatSelection): { from: number; to: number; reversed: boolean } {
  const reversed = selection.anchor > selection.head;
  return {
    from: Math.min(selection.anchor, selection.head),
    to: Math.max(selection.anchor, selection.head),
    reversed,
  };
}

function buildResult(
  text: string,
  from: number,
  to: number,
  reversed: boolean
): InlineFormatResult {
  return reversed
    ? { text, anchor: to, head: from }
    : { text, anchor: from, head: to };
}

function removeSelectedMarkers(
  text: string,
  from: number,
  to: number,
  marker: string,
  reversed: boolean
): InlineFormatResult | null {
  const markerLength = marker.length;
  const selected = text.slice(from, to);
  if (
    selected.length <= markerLength * 2 ||
    !selected.startsWith(marker) ||
    !selected.endsWith(marker)
  ) {
    return null;
  }
  const nextText = text.slice(0, from) +
    selected.slice(markerLength, selected.length - markerLength) +
    text.slice(to);
  return buildResult(nextText, from, to - markerLength * 2, reversed);
}

function removeSurroundingMarkers(
  text: string,
  from: number,
  to: number,
  marker: string,
  reversed: boolean
): InlineFormatResult | null {
  const markerLength = marker.length;
  if (
    from < markerLength ||
    text.slice(from - markerLength, from) !== marker ||
    text.slice(to, to + markerLength) !== marker
  ) {
    return null;
  }
  const nextText = text.slice(0, from - markerLength) +
    text.slice(from, to) +
    text.slice(to + markerLength);
  return buildResult(nextText, from - markerLength, to - markerLength, reversed);
}

export function applyInlineFormat(
  text: string,
  selection: InlineFormatSelection,
  format: MarkdownInlineFormat
): InlineFormatResult {
  const marker = MARKERS[format];
  const markerLength = marker.length;
  const { from, to, reversed } = normalizeSelection(selection);

  if (from === to) {
    const nextText = text.slice(0, from) + marker + marker + text.slice(to);
    const cursor = from + markerLength;
    return { text: nextText, anchor: cursor, head: cursor };
  }

  const selectedRemoval = removeSelectedMarkers(text, from, to, marker, reversed);
  if (selectedRemoval) {
    return selectedRemoval;
  }

  const surroundingRemoval = removeSurroundingMarkers(text, from, to, marker, reversed);
  if (surroundingRemoval) {
    return surroundingRemoval;
  }

  const nextText = text.slice(0, from) + marker + text.slice(from, to) + marker + text.slice(to);
  return buildResult(nextText, from + markerLength, to + markerLength, reversed);
}

export function clearInlineFormatting(
  text: string,
  selection: InlineFormatSelection
): InlineFormatResult | null {
  const { from, to, reversed } = normalizeSelection(selection);

  for (const marker of CLEAR_MARKERS) {
    const selectedRemoval = removeSelectedMarkers(text, from, to, marker, reversed);
    if (selectedRemoval) {
      return selectedRemoval;
    }
    const surroundingRemoval = removeSurroundingMarkers(text, from, to, marker, reversed);
    if (surroundingRemoval) {
      return surroundingRemoval;
    }
  }

  return null;
}
