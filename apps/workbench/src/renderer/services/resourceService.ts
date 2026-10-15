import { useTabManagerStore } from '../store/tabManagerStore';
import { useAppStore } from '../store/appStore';
import { dirnamePosix, normalizePosixPath } from '../utils/markdownMedia';
import {
  canonicalFileURI,
  fileUrlToAbsolutePath,
  isAbsolutePosixPath,
  isDataUrl,
  isFileUrl,
  isHttpUrl,
  parseCanonicalFileURI,
  type RenderHandle,
  type ResourceMeta,
  type ResourceTarget,
} from '../core/resource/uri';

export type ResourceImportPurpose = 'markdown-image' | 'attachment';

type ResourceImportResult = {
  documentRef: string;
  target: ResourceTarget;
  renderHandle?: RenderHandle;
};

const renderHandleCache = new Map<string, RenderHandle>();

function renderHandleCacheKey(
  target: Extract<ResourceTarget, { kind: 'file' }>,
  workspaceTabId: string,
  intent: 'render' | 'download' = 'render',
): string {
  return `${workspaceTabId}:${intent}:${target.uri}`;
}

function activeTabId(): string {
  return useTabManagerStore.getState().activeTabId;
}

export function authorityIdForWorkspace(workspaceTabId = activeTabId()): string {
  const state = useAppStore.getStoreByTabId(workspaceTabId).getState();
  return (state.instanceID || state.remoteSession?.instanceId || 'local').trim();
}

export function canonicalFileURIFromPath(path: string, workspaceTabId = activeTabId()): string {
  return canonicalFileURI(authorityIdForWorkspace(workspaceTabId), normalizePosixPath(path));
}

export function resolveResourceTargetFromRef(
  documentPath: string | null,
  rawRef: string,
  workspaceTabId = activeTabId(),
): ResourceTarget {
  const value = rawRef.trim();
  if (!value) throw new Error('Resource reference is empty');
  if (isDataUrl(value)) return { kind: 'data', url: value };
  if (isHttpUrl(value)) return { kind: 'external', url: value };
  if (isFileUrl(value)) return { kind: 'file', uri: canonicalFileURIFromPath(fileUrlToAbsolutePath(value), workspaceTabId) };
  const path = isAbsolutePosixPath(value)
    ? normalizePosixPath(value)
    : normalizePosixPath(`${dirnamePosix(documentPath || '')}/${value}`);
  return { kind: 'file', uri: canonicalFileURIFromPath(path, workspaceTabId) };
}

function mimeType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  return extension === 'pdf' ? 'application/pdf'
    : extension === 'epub' ? 'application/epub+zip'
      : extension === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : extension === 'png' ? 'image/png'
          : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
            : extension === 'gif' ? 'image/gif'
              : extension === 'webp' ? 'image/webp'
                : 'application/octet-stream';
}

function physicalPath(target: ResourceTarget): string {
  if (target.kind !== 'file') throw new Error('Only workspace files use resource handles');
  return parseCanonicalFileURI(target.uri).path;
}

export function buildResourceGrantRoots(extraPaths: string[] = []): string[] {
  return [...new Set(extraPaths.map(normalizePosixPath).filter((path) => path.startsWith('/')))];
}

export async function createResourceGrantToken(): Promise<string> {
  return 'desktop-main';
}

export async function inspectResource(
  target: ResourceTarget,
  workspaceTabId = activeTabId(),
): Promise<ResourceMeta> {
  if (target.kind === 'external' || target.kind === 'data') {
    return { target, name: target.url, mimeType: '', exists: true, renderable: true, downloadable: true };
  }
  const path = physicalPath(target);
  try {
    const stat = await window.hulala!.desktop.files.stat(workspaceTabId, path) as { name: string; size: number; isDir: boolean; modTime: number };
    return {
      target,
      name: stat.name,
      mimeType: mimeType(path),
      size: stat.size,
      entryType: stat.isDir ? 'directory' : 'file',
      exists: true,
      renderable: !stat.isDir,
      downloadable: !stat.isDir,
      canonicalFileURI: target.uri,
      lastModified: String(stat.modTime),
    };
  } catch {
    return { target, name: path.split('/').pop() || path, mimeType: mimeType(path), exists: false, renderable: false, downloadable: false, canonicalFileURI: target.uri };
  }
}

export async function getRenderHandle(
  target: ResourceTarget,
  workspaceTabId = activeTabId(),
  intent: 'render' | 'download' = 'render',
): Promise<RenderHandle> {
  if (target.kind === 'external' || target.kind === 'data') {
    return { handleId: target.url, url: target.url, expiresAt: new Date(Date.now() + 600_000).toISOString(), intent, mimeType: '' };
  }
  const path = physicalPath(target);
  if (target.kind !== 'file') throw new Error('Only workspace files use resource handles');
  const key = renderHandleCacheKey(target, workspaceTabId, intent);
  const cached = renderHandleCache.get(key);
  if (cached && new Date(cached.expiresAt).getTime() - Date.now() > 5_000) return cached;
  renderHandleCache.delete(key);
  const handle = await window.hulala!.desktop.resources.handle(workspaceTabId, path);
  const result = { handleId: handle.id, url: handle.url, expiresAt: handle.expiresAt, intent, mimeType: mimeType(path), size: handle.size, entryType: 'file' } satisfies RenderHandle;
  if (intent === 'render') renderHandleCache.set(key, result);
  return result;
}

async function renderBundle(path: string, workspaceTabId: string, intent: 'render' | 'download') {
  const target = { kind: 'file', uri: canonicalFileURIFromPath(path, workspaceTabId) } satisfies ResourceTarget;
  const meta = await inspectResource(target, workspaceTabId);
  if (!meta.exists || meta.entryType !== 'file') throw new Error('Resource does not exist');
  const handle = await getRenderHandle(target, workspaceTabId, intent);
  const url = new URL(handle.url, location.href);
  if (meta.lastModified) url.searchParams.set('v', meta.lastModified);
  return { url: url.toString(), meta, handle: { ...handle, url: url.toString() } };
}

export async function getRenderUrlForPhysicalPath(path: string, workspaceTabId = activeTabId()): Promise<string> {
  return (await renderBundle(path, workspaceTabId, 'render')).url;
}

export async function getRenderHandleForPhysicalPath(path: string, workspaceTabId = activeTabId()) {
  return renderBundle(path, workspaceTabId, 'render');
}

export async function getDownloadHandleForPhysicalPath(path: string, workspaceTabId = activeTabId()) {
  return renderBundle(path, workspaceTabId, 'download');
}

export async function getRenderUrlForReference(documentPath: string | null, rawRef: string, workspaceTabId = activeTabId()): Promise<string> {
  const target = resolveResourceTargetFromRef(documentPath, rawRef, workspaceTabId);
  if (target.kind === 'external' || target.kind === 'data') return target.url;
  return getRenderUrlForPhysicalPath(physicalPath(target), workspaceTabId);
}

export async function resolveLooseResourceUrl(value: string | null | undefined, workspaceTabId = activeTabId()): Promise<string> {
  const trimmed = (value || '').trim();
  if (!trimmed || isHttpUrl(trimmed) || isDataUrl(trimmed)) return trimmed;
  return getRenderUrlForPhysicalPath(isFileUrl(trimmed) ? fileUrlToAbsolutePath(trimmed) : trimmed, workspaceTabId);
}

export async function uploadFileToPath(file: Blob, targetPath: string, workspaceTabId = activeTabId(), expectedVersion: string | null = null, upload?: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void }): Promise<RenderHandle> {
  const imported = await window.hulala!.desktop.resources.import(
    workspaceTabId,
    targetPath,
    file,
    file.type || 'application/octet-stream',
    expectedVersion,
    upload,
  );
  return {
    handleId: imported.resource.id,
    url: imported.resource.url,
    expiresAt: imported.resource.expiresAt,
    intent: 'render',
    mimeType: file.type || mimeType(targetPath),
    size: imported.resource.size,
    entryType: 'file',
  };
}

export async function importFile(
  input: { purpose: ResourceImportPurpose; targetDocumentPath: string; file: File },
  workspaceTabId = activeTabId(),
): Promise<ResourceImportResult> {
  const name = (input.file.name || 'file').replace(/[\\/\0]/g, '_');
  const relative = input.purpose === 'markdown-image' ? `assets/${name}` : name;
  const targetPath = normalizePosixPath(`${dirnamePosix(input.targetDocumentPath)}/${relative}`);
  const renderHandle = await uploadFileToPath(input.file, targetPath, workspaceTabId);
  const target = { kind: 'file', uri: canonicalFileURIFromPath(targetPath, workspaceTabId) } satisfies ResourceTarget;
  renderHandleCache.set(renderHandleCacheKey(target, workspaceTabId), renderHandle);
  return { documentRef: relative, target, renderHandle };
}

export function base64ToFile(base64: string, fileName: string, mime: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], fileName, { type: mime });
}
