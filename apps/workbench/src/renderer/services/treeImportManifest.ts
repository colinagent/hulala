export type TreeImportEntry = {
  kind: 'file' | 'dir';
  relativePath: string;
  size?: number;
};

export type TreeImportManifestFile = {
  relativePath: string;
  file: File;
};

export type TreeImportManifestResult = {
  entries: TreeImportEntry[];
  files: TreeImportManifestFile[];
};

export type TreeImportSourceEntry =
  | {
      kind: 'file';
      relativePath: string;
      file: File;
    }
  | {
      kind: 'dir';
      relativePath: string;
    };

export type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
};

type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (
    success: (file: File) => void,
    error?: (reason?: unknown) => void,
  ) => void;
};

type FileSystemDirectoryReaderLike = {
  readEntries: (
    success: (entries: FileSystemEntryLike[]) => void,
    error?: (reason?: unknown) => void,
  ) => void;
};

type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  createReader: () => FileSystemDirectoryReaderLike;
};

function joinRelativePath(parent: string, child: string) {
  const prefix = parent.trim();
  const suffix = child.trim();
  if (!prefix) return suffix;
  if (!suffix) return prefix;
  return `${prefix}/${suffix}`;
}

export function normalizeTreeImportRelativePath(rawPath: string): string {
  const normalized = rawPath.replaceAll('\\', '/').trim();
  if (!normalized) {
    throw new Error('Relative path is required');
  }
  if (normalized.startsWith('/')) {
    throw new Error('Relative path must not be absolute');
  }

  const parts = normalized.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === '.') {
      continue;
    }
    if (trimmed === '..') {
      throw new Error('Relative path must stay within the drop root');
    }
    stack.push(trimmed);
  }

  if (stack.length === 0) {
    throw new Error('Relative path is required');
  }
  return stack.join('/');
}

function readFileFromEntry(entry: FileSystemFileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, (reason) => {
      reject(reason instanceof Error ? reason : new Error('Failed to read dropped file'));
    });
  });
}

async function readDirectoryEntries(entry: FileSystemDirectoryEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader();
  const entries: FileSystemEntryLike[] = [];

  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, (reason) => {
        reject(reason instanceof Error ? reason : new Error('Failed to read dropped directory'));
      });
    });
    if (batch.length === 0) {
      return entries;
    }
    entries.push(...batch);
  }
}

async function collectFromEntry(
  entry: FileSystemEntryLike,
  parentPath = '',
): Promise<TreeImportSourceEntry[]> {
  const relativePath = normalizeTreeImportRelativePath(joinRelativePath(parentPath, entry.name));
  if (entry.isFile) {
    const file = await readFileFromEntry(entry as FileSystemFileEntryLike);
    return [{
      kind: 'file',
      relativePath,
      file,
    }];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const children = await readDirectoryEntries(entry as FileSystemDirectoryEntryLike);
  const nestedEntries: TreeImportSourceEntry[] = [{
    kind: 'dir',
    relativePath,
  }];
  for (const child of children) {
    nestedEntries.push(...await collectFromEntry(child, relativePath));
  }
  return nestedEntries;
}

export async function collectTreeImportEntriesFromFileSystemEntries(
  entries: readonly FileSystemEntryLike[],
): Promise<TreeImportSourceEntry[]> {
  const collected: TreeImportSourceEntry[] = [];
  for (const entry of entries) {
    collected.push(...await collectFromEntry(entry));
  }
  return collected;
}

function ensureParentDirectories(relativePath: string, directoryPaths: Set<string>) {
  const parts = relativePath.split('/');
  let current = '';
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = current ? `${current}/${parts[index]}` : parts[index];
    directoryPaths.add(current);
  }
}

export function collectTreeImportEntriesFromFiles(
  files: Iterable<File>,
): TreeImportSourceEntry[] {
  const fileEntries: TreeImportSourceEntry[] = [];
  const directoryPaths = new Set<string>();

  for (const file of files) {
    const rawRelativePath = (file.webkitRelativePath || file.name || '').trim();
    const relativePath = normalizeTreeImportRelativePath(rawRelativePath);
    ensureParentDirectories(relativePath, directoryPaths);
    fileEntries.push({
      kind: 'file',
      relativePath,
      file,
    });
  }

  const directoryEntries = Array.from(directoryPaths)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    .map<TreeImportSourceEntry>((relativePath) => ({
      kind: 'dir',
      relativePath,
    }));

  return [...directoryEntries, ...fileEntries];
}

export function buildTreeImportManifest(
  sourceEntries: readonly TreeImportSourceEntry[],
): TreeImportManifestResult {
  if (sourceEntries.length === 0) {
    throw new Error('No dropped files are available for import');
  }

  const entryByPath = new Map<string, TreeImportEntry>();
  const fileByPath = new Map<string, File>();

  for (const entry of sourceEntries) {
    const relativePath = normalizeTreeImportRelativePath(entry.relativePath);
    const existingEntry = entryByPath.get(relativePath);

    if (entry.kind === 'dir') {
      if (!existingEntry) {
        entryByPath.set(relativePath, {
          kind: 'dir',
          relativePath,
        });
      } else if (existingEntry.kind !== 'dir') {
        throw new Error(`Import manifest contains conflicting kinds for ${relativePath}`);
      }
      continue;
    }

    if (existingEntry && existingEntry.kind !== 'file') {
      throw new Error(`Import manifest contains conflicting kinds for ${relativePath}`);
    }
    if (!existingEntry) {
      entryByPath.set(relativePath, {
        kind: 'file',
        relativePath,
        size: entry.file.size,
      });
    }
    if (!fileByPath.has(relativePath)) {
      fileByPath.set(relativePath, entry.file);
    }
  }

  const entries = Array.from(entryByPath.values()).sort((left, right) => {
    const leftDepth = left.relativePath.split('/').length;
    const rightDepth = right.relativePath.split('/').length;
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }
    if (left.kind !== right.kind) {
      return left.kind === 'dir' ? -1 : 1;
    }
    return left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' });
  });

  for (const entry of entries) {
    const parts = entry.relativePath.split('/');
    let parent = '';
    for (let index = 0; index < parts.length - 1; index += 1) {
      parent = parent ? `${parent}/${parts[index]}` : parts[index];
      const parentEntry = entryByPath.get(parent);
      if (parentEntry && parentEntry.kind !== 'dir') {
        throw new Error(`Import manifest contains a file ancestor at ${parent}`);
      }
    }
  }

  const files = Array.from(fileByPath.entries())
    .map<TreeImportManifestFile>(([relativePath, file]) => ({ relativePath, file }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' }));

  return { entries, files };
}
