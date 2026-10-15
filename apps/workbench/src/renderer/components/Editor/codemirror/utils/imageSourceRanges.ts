export type SelectionLike = {
  from: number;
  to: number;
  head: number;
  empty: boolean;
};

export type MarkdownImageSourceMatch = {
  alt: string;
  url: string;
  widthPercent: number | null;
  replaceFrom: number;
  replaceTo: number;
  sourceFrom: number;
  sourceTo: number;
  trailingText: string;
};

function splitMarkdownImageAttributeBlock(value: string): { main: string; attrs: string | null } {
  const trimmed = value.trim();
  if (!trimmed.endsWith('}')) {
    return { main: trimmed, attrs: null };
  }
  const closeParenIndex = trimmed.lastIndexOf(')');
  if (closeParenIndex === -1 || closeParenIndex >= trimmed.length - 2) {
    return { main: trimmed, attrs: null };
  }
  if (trimmed[closeParenIndex + 1] !== '{') {
    return { main: trimmed, attrs: null };
  }
  return {
    main: trimmed.slice(0, closeParenIndex + 1),
    attrs: trimmed.slice(closeParenIndex + 2, -1),
  };
}

function parseWidthPercent(attrs: string | null): number | null {
  if (!attrs) {
    return null;
  }
  const match = attrs.trim().match(/^width\s*=\s*(\d{1,3})%$/i);
  if (!match) {
    return null;
  }
  const width = Number.parseInt(match[1], 10);
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }
  return width;
}

function parseImageSourceText(text: string): {
  alt: string;
  url: string;
  widthPercent: number | null;
} | null {
  const value = (text || '').trim();
  if (!value.startsWith('![')) {
    return null;
  }
  const { main, attrs } = splitMarkdownImageAttributeBlock(value);
  if (!main.endsWith(')')) {
    return null;
  }
  const match = main.match(/^!\[([^\]]*)\]\((.*)\)$/);
  if (!match) {
    return null;
  }
  const alt = (match[1] || '').trim();
  const inner = (match[2] || '').trim();
  if (!inner) {
    return null;
  }
  if (inner.startsWith('<')) {
    const close = inner.indexOf('>');
    if (close <= 1) {
      return null;
    }
    const url = inner.slice(1, close).trim();
    return url ? { alt, url, widthPercent: parseWidthPercent(attrs) } : null;
  }
  const firstWhitespace = inner.search(/\s/);
  const url = (firstWhitespace === -1 ? inner : inner.slice(0, firstWhitespace)).trim();
  return url ? { alt, url, widthPercent: parseWidthPercent(attrs) } : null;
}

export function isImageSourceActive(
  selection: SelectionLike,
  from: number,
  to: number
): boolean {
  if (selection.empty) {
    return selection.head >= from && selection.head <= to;
  }
  return selection.from < to && selection.to > from;
}

export function matchLeadingMarkdownImage(text: string): MarkdownImageSourceMatch | null {
  const match = text.match(/^!\[([^\]]*)\]\(([^)]+)\)(?:\{[^}]+\})?(\s*)(.*)$/u);
  if (!match) {
    return null;
  }

  const full = match[0];
  const spacing = match[3] || '';
  const trailingText = (match[4] || '').trim();
  const replaceTo = full.length - trailingText.length;
  const sourceText = full.slice(0, replaceTo).trimEnd();
  const parsed = parseImageSourceText(sourceText);
  if (!parsed) {
    return null;
  }

  return {
    alt: parsed.alt,
    url: parsed.url,
    widthPercent: parsed.widthPercent,
    replaceFrom: 0,
    replaceTo: replaceTo - spacing.length,
    sourceFrom: 0,
    sourceTo: replaceTo - spacing.length,
    trailingText,
  };
}

export function matchHeadingAvatarImage(text: string): MarkdownImageSourceMatch | null {
  const regex = /!\[([^\]]*)\]\(([^)]+)\)(?:\{[^}]+\})?(\s*)/u;
  const match = regex.exec(text);
  if (!match) {
    return null;
  }

  const start = match.index;
  const spacing = match[3] || '';
  const replaceTo = start + match[0].length;
  const sourceText = match[0].trimEnd();
  const parsed = parseImageSourceText(sourceText);
  if (!parsed) {
    return null;
  }

  const remaining = `${text.slice(0, start)} ${text.slice(replaceTo)}`.trim();
  if (!remaining) {
    return null;
  }

  return {
    alt: parsed.alt,
    url: parsed.url,
    widthPercent: parsed.widthPercent,
    replaceFrom: start,
    replaceTo: replaceTo - spacing.length,
    sourceFrom: start,
    sourceTo: replaceTo - spacing.length,
    trailingText: remaining,
  };
}
