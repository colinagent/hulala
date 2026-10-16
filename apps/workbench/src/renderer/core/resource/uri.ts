import { normalizePosixPath } from '../../utils/markdownMedia';

export type CanonicalFileURI = string;
export type EphemeralResourceURI = string;

export type ResourceTarget =
  | { kind: 'file'; uri: CanonicalFileURI }
  | { kind: 'external'; url: string }
  | { kind: 'data'; url: string }
  | { kind: 'ephemeral'; uri: EphemeralResourceURI };

export type ResourceMeta = {
  target: ResourceTarget;
  name: string;
  mimeType: string;
  size?: number;
  entryType?: 'file' | 'directory';
  epubPackagePath?: string;
  exists: boolean;
  renderable: boolean;
  downloadable: boolean;
  canonicalFileURI?: CanonicalFileURI;
  lastModified?: string;
};

export type RenderHandle = {
  handleId: string;
  url: string;
  expiresAt: string;
  intent: 'render' | 'download';
  mimeType: string;
  size?: number;
  entryType?: 'file' | 'directory';
  epubPackagePath?: string;
};

export function isDataUrl(value: string): boolean {
  return value.trim().startsWith('data:');
}

export function isHttpUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

export function isFileUrl(value: string): boolean {
  return value.trim().toLowerCase().startsWith('file://');
}

export function isAbsoluteResourcePath(value: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value.trim());
}

export function normalizeResourcePath(value: string): string {
  const path = value.trim();
  const drive = /^([A-Za-z]):[\\/](.*)$/s.exec(path);
  if (drive) return drive[1].toUpperCase() + ':' + normalizePosixPath('/' + drive[2].replaceAll('\\', '/'));
  if (path.startsWith('\\\\') || path.startsWith('//')) {
    const [host, share, ...parts] = path.replaceAll('\\', '/').slice(2).split('/');
    if (!host || !share) throw new Error('UNC resource path requires a server and share');
    return `//${host}/${share}${normalizePosixPath('/' + parts.join('/'))}`;
  }
  return normalizePosixPath(path);
}

export function looksLikeResourcePath(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && !isDataUrl(trimmed) && !isHttpUrl(trimmed);
}

export function encodeAuthority(authorityId: string): string {
  return encodeURIComponent(authorityId.trim());
}

export function decodeAuthority(encodedAuthority: string): string {
  return decodeURIComponent(encodedAuthority);
}

export function canonicalFileURI(authorityId: string, absolutePath: string): CanonicalFileURI {
  if (!isAbsoluteResourcePath(absolutePath)) {
    throw new Error(`Canonical file URI requires an absolute path: ${absolutePath}`);
  }
  const physicalPath = normalizeResourcePath(absolutePath);
  const normalizedPath = /^[A-Z]:\//.test(physicalPath) ? '/' + physicalPath : physicalPath;
  const encodedPath = normalizedPath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `opfs://${encodeAuthority(authorityId)}${encodedPath}`;
}

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export function parseCanonicalFileURI(uri: string): { authorityId: string; path: string } {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'opfs:') {
    throw new Error(`Unsupported canonical file URI: ${uri}`);
  }
  const decoded = decodePathname(parsed.pathname || '');
  const path = normalizeResourcePath(/^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded);
  if (!isAbsoluteResourcePath(path)) {
    throw new Error(`Canonical file URI is missing absolute path: ${uri}`);
  }
  return {
    authorityId: decodeAuthority(parsed.host || ''),
    path,
  };
}

export function fileUrlToAbsolutePath(fileUrl: string): string {
  const parsed = new URL(fileUrl);
  if (parsed.protocol !== 'file:') throw new Error('Expected a file URL');
  const path = decodePathname(parsed.pathname || '');
  if (parsed.hostname && parsed.hostname !== 'localhost') return normalizeResourcePath('//' + parsed.hostname + path);
  return normalizeResourcePath(/^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path);
}

export function resourceTargetKey(target: ResourceTarget): string {
  switch (target.kind) {
    case 'file':
      return `file:${target.uri}`;
    case 'ephemeral':
      return `ephemeral:${target.uri}`;
    case 'external':
      return `external:${target.url}`;
    case 'data':
      return `data:${target.url}`;
  }
}
