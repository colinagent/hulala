function normalizePosixPath(path: string): string {
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

function dirnamePosix(path: string): string {
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

function splitPosixParts(path: string): string[] {
  const normalized = normalizePosixPath((path || '').trim());
  if (!normalized) {
    return [];
  }
  return normalized.split('/').filter(Boolean);
}

function relativePosixPath(fromDir: string, toPath: string): string {
  const fromParts = splitPosixParts(fromDir);
  const toParts = splitPosixParts(toPath);
  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) {
    shared += 1;
  }
  const up = new Array(Math.max(0, fromParts.length - shared)).fill('..');
  const down = toParts.slice(shared);
  const result = [...up, ...down].join('/');
  return result || '.';
}

function escapeMarkdownLinkText(text: string): string {
  return (text || '').replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

export function buildRelativePlanLink(chatPath: string, planPath: string): string {
  const fromDir = dirnamePosix(normalizePosixPath((chatPath || '').trim()));
  const toFile = normalizePosixPath((planPath || '').trim());
  if (!fromDir || !toFile) {
    return '';
  }
  return relativePosixPath(fromDir, toFile);
}

export function buildPlanReferenceBlock(title: string, relativePath: string): string {
  const normalizedTitle = (title || '').trim() || 'Plan';
  const normalizedPath = (relativePath || '').trim();
  if (!normalizedPath) {
    return '';
  }
  return `> Plan: [${escapeMarkdownLinkText(normalizedTitle)}](${normalizedPath})`;
}

export function hasPlanReference(chatContent: string, relativePath: string): boolean {
  const normalizedContent = typeof chatContent === 'string' ? chatContent.replace(/\r\n/g, '\n') : '';
  const normalizedPath = (relativePath || '').trim();
  if (!normalizedContent || !normalizedPath) {
    return false;
  }
  return normalizedContent.includes(`](${normalizedPath})`);
}

export function appendPlanReference(chatContent: string, block: string): string {
  const normalizedContent = typeof chatContent === 'string' ? chatContent.replace(/\r\n/g, '\n') : '';
  const normalizedBlock = (block || '').trim();
  if (!normalizedBlock) {
    return normalizedContent;
  }
  const trimmed = normalizedContent.replace(/\s+$/g, '');
  if (!trimmed) {
    return `${normalizedBlock}\n`;
  }
  return `${trimmed}\n\n${normalizedBlock}\n`;
}
