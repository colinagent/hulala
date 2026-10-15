import type { FileEntry } from '../../services/fileService';

export const FILE_TREE_TRANSFER_MIME = 'application/x-hulala-file-tree-items';
export const FILE_TREE_TRANSFER_SENTINEL = 'hulala-tree-transfer';

export type FileTreeTransferItem = {
  path: string;
  isDir: boolean;
};

export type FileTreeTransferPayload = {
  items: FileTreeTransferItem[];
};

export type PreparedFileTreeTransferOp = {
  sourcePath: string;
  sourceIsDir: boolean;
  targetPath: string;
  targetDir: string;
};

function normalizePath(path: string): string {
  const trimmed = (path || '').trim();
  if (!trimmed) return '';
  if (trimmed === '/') return '/';
  return trimmed.replace(/\/+$|\/+$/g, '').replace(/\/\/{2,}/g, '/');
}

export function getParentDir(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized || normalized === '/') return '/';
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return '/';
  return normalized.slice(0, index);
}

export function getBaseName(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized || normalized === '/') return normalized;
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function joinPath(dir: string, name: string): string {
  const normalizedDir = normalizePath(dir);
  const trimmedName = (name || '').trim();
  if (!normalizedDir || normalizedDir === '/') {
    return `/${trimmedName}`;
  }
  return `${normalizedDir}/${trimmedName}`;
}

export function isEqualOrParent(parent: string, child: string): boolean {
  const normalizedParent = normalizePath(parent);
  const normalizedChild = normalizePath(child);
  if (!normalizedParent || !normalizedChild) return false;
  if (normalizedParent === normalizedChild) return true;
  return normalizedChild.startsWith(`${normalizedParent}/`);
}

export function dedupeTopLevelItems(items: FileTreeTransferItem[]): FileTreeTransferItem[] {
  const normalized = items
    .map((item) => ({ ...item, path: normalizePath(item.path) }))
    .filter((item) => !!item.path)
    .sort((a, b) => a.path.localeCompare(b.path));

  const result: FileTreeTransferItem[] = [];
  for (const item of normalized) {
    if (result.some((existing) => isEqualOrParent(existing.path, item.path))) {
      continue;
    }
    result.push(item);
  }
  return result;
}

export function canMoveOrCopyIntoTarget(
  items: FileTreeTransferItem[],
  targetDir: string,
  isCopy: boolean,
): { ok: true } | { ok: false; reason: string } {
  const normalizedTargetDir = normalizePath(targetDir);
  if (!normalizedTargetDir) {
    return { ok: false, reason: 'Invalid target directory' };
  }

  for (const item of items) {
    const sourcePath = normalizePath(item.path);
    if (!sourcePath) {
      return { ok: false, reason: 'Invalid source path' };
    }
    if (sourcePath === normalizedTargetDir) {
      return { ok: false, reason: 'Cannot move into itself' };
    }
    if (item.isDir && isEqualOrParent(sourcePath, normalizedTargetDir)) {
      return { ok: false, reason: 'Cannot move a folder into itself' };
    }
    if (!isCopy && getParentDir(sourcePath) === normalizedTargetDir) {
      continue;
    }
  }

  return { ok: true };
}

export function encodeFileTreeTransfer(items: FileTreeTransferItem[]): string {
  return JSON.stringify({ items: dedupeTopLevelItems(items) } satisfies FileTreeTransferPayload);
}

export function decodeFileTreeTransfer(raw: string): FileTreeTransferItem[] {
  try {
    const parsed = JSON.parse(raw) as FileTreeTransferPayload;
    if (!parsed || !Array.isArray(parsed.items)) return [];
    return dedupeTopLevelItems(parsed.items.filter((item): item is FileTreeTransferItem => (
      !!item && typeof item.path === 'string' && typeof item.isDir === 'boolean'
    )));
  } catch {
    return [];
  }
}

export function readFileTreeTransfer(dataTransfer: DataTransfer | null | undefined): FileTreeTransferItem[] {
  if (!dataTransfer) return [];
  const raw = dataTransfer.getData(FILE_TREE_TRANSFER_MIME);
  return decodeFileTreeTransfer(raw);
}

export function hasFileTreeTransfer(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  return types.includes(FILE_TREE_TRANSFER_MIME)
    || types.includes('text/plain') && (dataTransfer.getData('text/plain') || '').trim() === FILE_TREE_TRANSFER_SENTINEL;
}

function splitNameForCopy(name: string): { stem: string; ext: string } {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0) {
    return { stem: name, ext: '' };
  }
  return {
    stem: name.slice(0, dotIndex),
    ext: name.slice(dotIndex),
  };
}

export function buildUniqueCopyName(name: string, existingNames: Set<string>): string {
  if (!existingNames.has(name)) {
    return name;
  }

  const { stem, ext } = splitNameForCopy(name);
  const base = `${stem} copy`;
  const firstCandidate = `${base}${ext}`;
  if (!existingNames.has(firstCandidate)) {
    return firstCandidate;
  }

  let index = 2;
  while (true) {
    const candidate = `${base} ${index}${ext}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

export function buildExistingNameSet(entries: FileEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.name));
}

export function prepareFileTreeTransferOps(params: {
  items: FileTreeTransferItem[];
  targetDir: string;
  targetEntries: FileEntry[];
  isCopy: boolean;
}): PreparedFileTreeTransferOp[] {
  const items = dedupeTopLevelItems(params.items);
  const targetDir = normalizePath(params.targetDir);
  const existingNames = buildExistingNameSet(params.targetEntries);
  const ops: PreparedFileTreeTransferOp[] = [];

  for (const item of items) {
    const sourcePath = normalizePath(item.path);
    if (!sourcePath) continue;

    const originalName = getBaseName(sourcePath);
    const desiredName = params.isCopy || getParentDir(sourcePath) !== targetDir
      ? buildUniqueCopyName(originalName, existingNames)
      : originalName;

    if (!params.isCopy && getParentDir(sourcePath) === targetDir) {
      continue;
    }

    existingNames.add(desiredName);
    ops.push({
      sourcePath,
      sourceIsDir: item.isDir,
      targetDir,
      targetPath: joinPath(targetDir, desiredName),
    });
  }

  return ops;
}

export function getVisibleFileTreePaths(container: HTMLElement | null): string[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>('[data-file-path]'))
    .map((element) => (element.dataset.filePath || '').trim())
    .filter(Boolean);
}
