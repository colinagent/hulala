const DECIMAL_MARKER_RE = /^(\d+)\.$/;
const LETTER_MARKER_RE = /^([A-Za-z]+)\.$/;

export type OrderedListStyle = 'decimal' | 'lower-alpha' | 'lower-roman';

export function orderedListStyleForDepth(depth: number): OrderedListStyle {
  switch (Math.max(0, depth) % 3) {
    case 1:
      return 'lower-alpha';
    case 2:
      return 'lower-roman';
    default:
      return 'decimal';
  }
}

function toLowerAlpha(value: number): string {
  let remaining = value;
  let result = '';
  while (remaining > 0) {
    remaining -= 1;
    result = String.fromCharCode(97 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}

function fromLowerAlpha(value: string): number | null {
  let result = 0;
  for (const character of value.toLowerCase()) {
    const digit = character.charCodeAt(0) - 96;
    if (digit < 1 || digit > 26) {
      return null;
    }
    result = result * 26 + digit;
    if (!Number.isSafeInteger(result)) {
      return null;
    }
  }
  return result || null;
}

function toLowerRoman(value: number): string | null {
  if (value < 1 || value > 3999) {
    return null;
  }

  const numerals: ReadonlyArray<readonly [number, string]> = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
    [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let remaining = value;
  let result = '';
  for (const [amount, numeral] of numerals) {
    while (remaining >= amount) {
      result += numeral;
      remaining -= amount;
    }
  }
  return result;
}

function fromLowerRoman(value: string): number | null {
  const normalized = value.toLowerCase();
  const values: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000,
  };
  let result = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const current = values[normalized[index]];
    if (!current) {
      return null;
    }
    const next = values[normalized[index + 1]] || 0;
    result += current < next ? -current : current;
  }
  return toLowerRoman(result) === normalized ? result : null;
}

export function isOrderedListMarker(markerText: string): boolean {
  if (DECIMAL_MARKER_RE.test(markerText)) {
    return true;
  }
  const letters = LETTER_MARKER_RE.exec(markerText)?.[1];
  if (!letters) {
    return false;
  }
  return letters.length <= 3 || fromLowerRoman(letters) !== null;
}

export function orderedListMarkerValue(markerText: string, depth: number): number | null {
  const decimal = DECIMAL_MARKER_RE.exec(markerText);
  if (decimal) {
    const value = Number(decimal[1]);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  const letters = LETTER_MARKER_RE.exec(markerText)?.[1];
  if (!letters) {
    return null;
  }
  if (orderedListStyleForDepth(depth) === 'lower-roman') {
    const roman = fromLowerRoman(letters);
    if (roman !== null) {
      return roman;
    }
  }
  return fromLowerAlpha(letters);
}

export function formatOrderedListMarker(value: number, depth: number): string | null {
  if (!Number.isSafeInteger(value) || value < 1) {
    return null;
  }
  switch (orderedListStyleForDepth(depth)) {
    case 'lower-alpha':
      return `${toLowerAlpha(value)}.`;
    case 'lower-roman': {
      const roman = toLowerRoman(value);
      return roman ? `${roman}.` : null;
    }
    default:
      return `${value}.`;
  }
}

export function normalizeOrderedListMarker(
  markerText: string,
  fromDepth: number,
  toDepth: number,
): string {
  const value = orderedListMarkerValue(markerText, fromDepth);
  return value === null ? markerText : formatOrderedListMarker(value, toDepth) || markerText;
}

export function firstOrderedListMarkerForDepth(depth: number): string {
  return formatOrderedListMarker(1, depth) || '1.';
}

export function nextOrderedListMarker(markerText: string, depth: number): string {
  const value = orderedListMarkerValue(markerText, depth);
  return value === null ? markerText : formatOrderedListMarker(value + 1, depth) || markerText;
}

function sourceDepth(indent: string): number {
  const columns = [...indent].reduce((total, character) => total + (character === '\t' ? 2 : 1), 0);
  return Math.min(Math.floor(columns / 2), 5);
}

/**
 * Normalize list markers in the actual Markdown source. Fenced code blocks and
 * frontmatter stay byte-for-byte unchanged.
 */
export function normalizeOrderedListMarkersInMarkdown(content: string): string {
  let inFrontmatter = false;
  let fence: { character: '`' | '~'; length: number } | null = null;
  return content.split('\n').map((line, index) => {
    if (index === 0 && line.trim() === '---') {
      inFrontmatter = true;
      return line;
    }
    if (inFrontmatter) {
      if (line.trim() === '---' || line.trim() === '...') {
        inFrontmatter = false;
      }
      return line;
    }

    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const character = marker[0] as '`' | '~';
      if (!fence) {
        fence = { character, length: marker.length };
      } else if (fence.character === character && marker.length >= fence.length) {
        fence = null;
      }
      return line;
    }
    if (fence) {
      return line;
    }

    const match = line.match(/^(\s*)(\d+\.|[A-Za-z]+\.)(\s+)/);
    if (!match || !isOrderedListMarker(match[2])) {
      return line;
    }
    const depth = sourceDepth(match[1]);
    const normalized = normalizeOrderedListMarker(match[2], depth, depth);
    return normalized === match[2]
      ? line
      : `${match[1]}${normalized}${match[3]}${line.slice(match[0].length)}`;
  }).join('\n');
}
