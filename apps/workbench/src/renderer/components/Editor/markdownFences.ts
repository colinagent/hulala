export type ParsedFenceLine = {
  indent: string;
  char: '`' | '~';
  width: number;
  info: string;
};

export function parseFenceLine(text: string): ParsedFenceLine | null {
  const trimmed = text.replace(/^\s*/, '');
  if (trimmed.length < 3) {
    return null;
  }

  const char = trimmed[0];
  if (char !== '`' && char !== '~') {
    return null;
  }

  let width = 0;
  while (width < trimmed.length && trimmed[width] === char) {
    width += 1;
  }
  if (width < 3) {
    return null;
  }

  return {
    indent: text.slice(0, text.length - trimmed.length),
    char,
    width,
    info: trimmed.slice(width).trim(),
  };
}

export function isMatchingFenceCloser(opener: ParsedFenceLine, text: string): boolean {
  const parsed = parseFenceLine(text);
  if (!parsed) {
    return false;
  }
  return (
    parsed.char === opener.char
    && parsed.width >= opener.width
    && parsed.info === ''
  );
}
