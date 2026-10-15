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

export function isAbsolutePosixPath(value: string): boolean {
  return value.trim().startsWith('/');
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
  const normalizedPath = normalizePosixPath(absolutePath.trim());
  if (!normalizedPath.startsWith('/')) {
    throw new Error(`Canonical file URI requires an absolute path: ${absolutePath}`);
  }
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
  const path = normalizePosixPath(decodePathname(parsed.pathname || ''));
  if (!path.startsWith('/')) {
    throw new Error(`Canonical file URI is missing absolute path: ${uri}`);
  }
  return {
    authorityId: decodeAuthority(parsed.host || ''),
    path,
  };
}

export function fileUrlToAbsolutePath(fileUrl: string): string {
  const parsed = new URL(fileUrl);
  return normalizePosixPath(decodePathname(parsed.pathname || ''));
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
