import { dirnamePosix } from '../../../utils/markdownMedia';

export function parseDrawingEmbed(text: string): { target: string; label: string } | null {
  const match = /^!\[\[([^\]\n|]+\.excalidraw)[ \t]*(?:\|([^\]\n]+))?\]\]$/i.exec(text.trim());
  return match ? { target: match[1].trim(), label: match[2]?.trim() || match[1].trim() } : null;
}

export function resolveDrawingPath(documentPath: string | null, target: string): string {
  if (!/\.excalidraw$/i.test(target) || /[\\\u0000-\u001f]|^[a-z][a-z\d+.-]*:|^~/i.test(target)) {
    throw new Error('invalidPath');
  }
  const combined = target.startsWith('/') ? target : `${dirnamePosix(documentPath || '')}/${target}`;
  const absolute = target.startsWith('/') || Boolean(documentPath?.startsWith('/'));
  const parts: string[] = [];
  for (const part of combined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('invalidPath');
      parts.pop();
    } else parts.push(part);
  }
  return `${absolute ? '/' : ''}${parts.join('/')}`;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Validate the file envelope before the SDK restores optional element defaults.
export function parseDrawingDocument(content: string): Record<string, unknown> & { elements: Record<string, unknown>[] } {
  let data: unknown;
  try { data = JSON.parse(content); } catch { throw new Error('invalidFile'); }
  if (!record(data) || data.type !== 'excalidraw' || !Array.isArray(data.elements)
    || (data.appState !== undefined && !record(data.appState))
    || (data.files !== undefined && !record(data.files))) throw new Error('invalidFile');
  for (const element of data.elements) {
    if (!record(element) || typeof element.id !== 'string' || typeof element.type !== 'string'
      || !['x', 'y', 'width', 'height'].every((key) => typeof element[key] === 'number' && Number.isFinite(element[key]))) {
      throw new Error('invalidFile');
    }
  }
  for (const file of Object.values(data.files || {})) {
    if (!record(file) || typeof file.dataURL !== 'string' || !/^data:image\/[a-z\d.+-]+;base64,/i.test(file.dataURL)) {
      throw new Error('invalidFile');
    }
  }
  return data as Record<string, unknown> & { elements: Record<string, unknown>[] };
}

export interface DrawingFileAccess {
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, content: string, baseline?: string | null): Promise<boolean>;
  statPath(path: string): Promise<{ error?: string; isDir?: boolean }>;
}

export async function readDrawingFile(access: DrawingFileAccess, path: string): Promise<string | null> {
  const stat = await access.statPath(path);
  if (stat.error) {
    if (/\bENOENT\b|\bfile_not_found\b|\bfile not found\b|\bno such file\b/i.test(stat.error)) return null;
    throw new Error('readFailed');
  }
  if (stat.isDir) throw new Error('invalidFile');
  const content = await access.readTextFile(path);
  if (content === null) throw new Error('readFailed');
  parseDrawingDocument(content);
  return content;
}

export async function saveDrawingFile(access: DrawingFileAccess, path: string, baseline: string | null, content: string): Promise<void> {
  parseDrawingDocument(content);
  // Recheck before saving so another editor's changes are not silently replaced.
  if (await readDrawingFile(access, path) !== baseline) throw new Error('conflict');
  if (!await access.writeTextFile(path, content, baseline)) throw new Error('saveFailed');
}
