export type MarkdownImage = {
  alt: string;
  url: string;
  widthPercent: number | null;
};

export const DEFAULT_CHAT_MARKDOWN_IMAGE_WIDTH_PERCENT = 10;

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

export function parseMarkdownImage(text: string): MarkdownImage | null {
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

export function replaceMarkdownImageWidth(text: string, widthPercent: number | null): string | null {
  const parsed = parseMarkdownImage(text);
  if (!parsed) {
    return null;
  }
  const suffix = widthPercent == null ? '' : `{width=${Math.floor(widthPercent)}%}`;
  return `![${parsed.alt}](${parsed.url})${suffix}`;
}

export function resolveRenderedMarkdownImageWidth(
  widthPercent: number | null | undefined,
  options?: { defaultWidthPercent?: number | null | undefined }
): number | null {
  if (typeof widthPercent === 'number' && Number.isFinite(widthPercent) && widthPercent > 0) {
    return Math.floor(widthPercent);
  }
  const fallback = options?.defaultWidthPercent;
  if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) {
    return Math.floor(fallback);
  }
  return null;
}

export function getDefaultMarkdownImageWidthPercent(
  currentFilePath: string | null | undefined
): number | null {
  const normalizedPath = normalizePosixPath((currentFilePath || '').trim());
  if (!normalizedPath || !/\.md$/i.test(normalizedPath)) {
    return null;
  }
  return (normalizedPath.includes('/.agent/chat/') || normalizedPath.startsWith('.agent/chat/'))
    ? DEFAULT_CHAT_MARKDOWN_IMAGE_WIDTH_PERCENT
    : null;
}

export function normalizePosixPath(path: string): string {
  const absolute = path.startsWith('/');
  const parts = path.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return `${absolute ? '/' : ''}${stack.join('/')}`;
}

export function dirnamePosix(path: string): string {
  if (!path) {
    return '';
  }
  const normalized = normalizePosixPath(path);
  if (normalized === '/') {
    return '/';
  }
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return normalized.startsWith('/') ? '/' : '';
  }
  return normalized.slice(0, index);
}

export function hasFileExtension(path: string): boolean {
  return /\.[a-z0-9]+$/i.test(path);
}

export function resolveMarkdownPath(
  currentFilePath: string | null,
  target: string,
  forceMarkdown: boolean
): string | null {
  let resolved = target.trim();
  if (!resolved) {
    return currentFilePath;
  }
  if (forceMarkdown && !hasFileExtension(resolved)) {
    resolved = `${resolved}.md`;
  }
  if (resolved.startsWith('/') || resolved.startsWith('~/')) {
    return resolved;
  }
  if (!currentFilePath) {
    return resolved;
  }
  return normalizePosixPath(`${dirnamePosix(currentFilePath)}/${resolved}`);
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(path);
}

function isDataUrl(value: string): boolean {
  return value.trim().toLowerCase().startsWith('data:');
}

function isHttpUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

function isFileUrl(value: string): boolean {
  return value.trim().toLowerCase().startsWith('file://');
}

function fileUrlToAbsolutePath(value: string): string | null {
  try {
    return normalizePosixPath(new URL(value).pathname || '');
  } catch {
    return null;
  }
}

export function resolveMarkdownImagePath(
  currentFilePath: string | null,
  rawUrl: string
): string | null {
  const target = rawUrl.trim();
  if (!target || isHttpUrl(target) || isDataUrl(target)) {
    return null;
  }
  const resolvedPath = isFileUrl(target)
    ? fileUrlToAbsolutePath(target)
    : resolveMarkdownPath(currentFilePath, target, false);
  if (!resolvedPath || !resolvedPath.startsWith('/') || !isImagePath(resolvedPath)) {
    return null;
  }
  return resolvedPath;
}
