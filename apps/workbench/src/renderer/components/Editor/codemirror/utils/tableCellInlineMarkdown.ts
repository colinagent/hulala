export type TableCellInlineSegment =
  | { type: 'text'; text: string }
  | { type: 'lineBreak' }
  | { type: 'code'; text: string }
  | { type: 'strong' | 'emphasis' | 'strikethrough' | 'highlight'; children: TableCellInlineSegment[] };

const LINE_BREAK_TOKEN_RE = /^<br\s*\/?>/i;
const ESCAPABLE_INLINE_CHARS = new Set("\\`!\"#$%&'()*+,-./:;<=>?@[]^_{|}~");

export function matchTableCellLineBreakToken(text: string, from: number): string | null {
  const match = text.slice(from).match(LINE_BREAK_TOKEN_RE);
  return match?.index === 0 ? match[0] : null;
}

function countRepeatedChar(text: string, index: number, ch: string): number {
  let cursor = index;
  while (cursor < text.length && text[cursor] === ch) {
    cursor += 1;
  }
  return cursor - index;
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

function findClosingBacktickRun(text: string, from: number, runLength: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] !== '`') {
      continue;
    }
    const nextRunLength = countRepeatedChar(text, index, '`');
    if (nextRunLength === runLength) {
      return index;
    }
    index += nextRunLength - 1;
  }
  return -1;
}

function pushTextSegment(segments: TableCellInlineSegment[], text: string): void {
  if (text.length === 0) {
    return;
  }
  const last = segments[segments.length - 1];
  if (last?.type === 'text') {
    last.text += text;
    return;
  }
  segments.push({ type: 'text', text });
}

function getSegmentPlainText(segment: TableCellInlineSegment): string {
  switch (segment.type) {
    case 'text':
      return segment.text;
    case 'lineBreak':
      return '\n';
    case 'code':
      return segment.text;
    case 'strong':
    case 'emphasis':
    case 'strikethrough':
    case 'highlight':
      return segment.children.map(getSegmentPlainText).join('');
  }
}

function hasNonWhitespaceContent(segments: readonly TableCellInlineSegment[]): boolean {
  return segments.map(getSegmentPlainText).join('').trim().length > 0;
}

function parseSegments(
  text: string,
  startIndex: number,
  stopMarker?: '**' | '*' | '~~' | '=='
): { segments: TableCellInlineSegment[]; index: number; closed: boolean } {
  const segments: TableCellInlineSegment[] = [];
  let index = startIndex;
  let textBuffer = '';

  const flushText = () => {
    pushTextSegment(segments, textBuffer);
    textBuffer = '';
  };

  while (index < text.length) {
    if (
      stopMarker &&
      text.startsWith(stopMarker, index) &&
      (stopMarker !== '==' || canCloseHighlightMarker(text, index))
    ) {
      flushText();
      return {
        segments,
        index: index + stopMarker.length,
        closed: true,
      };
    }

    const lineBreak = matchTableCellLineBreakToken(text, index);
    if (lineBreak) {
      flushText();
      segments.push({ type: 'lineBreak' });
      index += lineBreak.length;
      continue;
    }

    const ch = text[index];
    if (ch === '\\') {
      const next = text[index + 1] ?? '';
      if (ESCAPABLE_INLINE_CHARS.has(next)) {
        textBuffer += next;
        index += 2;
        continue;
      }
      textBuffer += ch;
      index += 1;
      continue;
    }

    if (ch === '`') {
      const runLength = countRepeatedChar(text, index, '`');
      const closingIndex = findClosingBacktickRun(text, index + runLength, runLength);
      if (closingIndex !== -1) {
        flushText();
        segments.push({
          type: 'code',
          text: text.slice(index + runLength, closingIndex),
        });
        index = closingIndex + runLength;
        continue;
      }
    }

    if (text.startsWith('**', index)) {
      const nested = parseSegments(text, index + 2, '**');
      if (nested.closed && hasNonWhitespaceContent(nested.segments)) {
        flushText();
        segments.push({ type: 'strong', children: nested.segments });
        index = nested.index;
        continue;
      }
    }

    if (text.startsWith('~~', index)) {
      const nested = parseSegments(text, index + 2, '~~');
      if (nested.closed && hasNonWhitespaceContent(nested.segments)) {
        flushText();
        segments.push({ type: 'strikethrough', children: nested.segments });
        index = nested.index;
        continue;
      }
    }

    if (canOpenHighlightMarker(text, index)) {
      const nested = parseSegments(text, index + 2, '==');
      if (nested.closed && hasNonWhitespaceContent(nested.segments)) {
        flushText();
        segments.push({ type: 'highlight', children: nested.segments });
        index = nested.index;
        continue;
      }
    }

    if (ch === '*') {
      const nested = parseSegments(text, index + 1, '*');
      if (nested.closed && hasNonWhitespaceContent(nested.segments)) {
        flushText();
        segments.push({ type: 'emphasis', children: nested.segments });
        index = nested.index;
        continue;
      }
    }

    textBuffer += ch;
    index += 1;
  }

  flushText();
  return { segments, index, closed: false };
}

export function parseTableCellInlineMarkdown(text: string): TableCellInlineSegment[] {
  return parseSegments(text.replace(/\r?\n/g, '<br>'), 0).segments;
}
