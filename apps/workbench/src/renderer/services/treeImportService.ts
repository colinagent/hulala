import { uploadFileToPath } from './resourceService';
import { useTabManagerStore } from '../store/tabManagerStore';
import {
  buildTreeImportManifest,
  collectTreeImportEntriesFromFileSystemEntries,
  collectTreeImportEntriesFromFiles,
  type FileSystemEntryLike,
  type TreeImportEntry,
  type TreeImportManifestResult,
} from './treeImportManifest';
import { hasExternalTreeImportPayload } from './treeImportPayload';

export { hasExternalTreeImportPayload } from './treeImportPayload';

export type PreparedTreeImport = {
  conflicts: string[];
  fileCount: number;
  dirCount: number;
  targetDir: string;
  commit: (overwrite: boolean | 'skip', options?: { signal?: AbortSignal; onProgress?: (name: string, loaded: number, total: number) => void }) => Promise<TreeImportCommitResult>;
  cancel: () => Promise<void>;
};

type TreeImportCommitResult = {
  importedFiles: number;
  importedDirs: number;
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

async function collectDroppedEntries(dataTransfer: DataTransfer): Promise<TreeImportManifestResult> {
  const items = Array.from(dataTransfer.items || []);
  const fileSystemEntries = items
    .map((item): FileSystemEntryLike | null => {
      const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.() || null;
      return entry as FileSystemEntryLike | null;
    })
    .filter((entry): entry is FileSystemEntryLike => entry !== null);

  if (fileSystemEntries.length > 0) {
    return buildTreeImportManifest(
      await collectTreeImportEntriesFromFileSystemEntries(fileSystemEntries),
    );
  }

  const files = Array.from(dataTransfer.files || []).filter((file) => Boolean(file));
  if (files.length === 0) {
    throw new Error('No dropped files are available for import');
  }
  return buildTreeImportManifest(collectTreeImportEntriesFromFiles(files));
}

type UploadBodySource =
  | { kind: 'file'; file: File }
  | { kind: 'local-path'; absolutePath: string };

type PreparedUploadManifest = {
  entries: TreeImportEntry[];
  uploads: Array<{ relativePath: string; body: UploadBodySource }>;
};

async function createPreparedTreeImport(
  targetDir: string,
  manifest: PreparedUploadManifest,
  workspaceTabId?: string,
): Promise<PreparedTreeImport> {
  const tabId = workspaceTabId || useTabManagerStore.getState().activeTabId;
  const targetPath = (relativePath: string) => `${targetDir.replace(/\/$/, '')}/${relativePath.replace(/^\//, '')}`;
  const conflicts: string[] = [];
  const versions = new Map<string, string>();
  for (const file of manifest.uploads) {
    try {
      const stat = await window.hulala!.desktop.files.stat(tabId, targetPath(file.relativePath));
      if (stat.isDir) throw new Error(`A directory occupies the destination: ${file.relativePath}`);
      conflicts.push(file.relativePath);
      versions.set(file.relativePath, stat.version);
    } catch (error) {
      if ((error as { status?: number }).status !== 404 && !/file not found|ENOENT/i.test(String(error))) throw error;
    }
  }

  let finalized = false;

  const cancel = async () => {
    finalized = true;
  };

  const commit: PreparedTreeImport['commit'] = async (overwrite, options) => {
    if (finalized) {
      throw new Error('Tree import session has already been finalized');
    }
    if (!overwrite && conflicts.length > 0) {
      throw new Error('Import conflicts must be confirmed before overwrite');
    }
    try {
      let importedFiles = 0;
      for (const entry of manifest.entries.filter((entry) => entry.kind === 'dir')) {
        options?.signal?.throwIfAborted();
        await window.hulala!.desktop.files.mkdir(tabId, targetPath(entry.relativePath));
      }
      for (const fileEntry of manifest.uploads) {
        options?.signal?.throwIfAborted();
        if (overwrite === 'skip' && versions.has(fileEntry.relativePath)) continue;
        let body: Blob;
        if (fileEntry.body.kind === 'file') {
          body = fileEntry.body.file;
        } else {
          const read = await window.hulala?.readLocalFileBinary?.(fileEntry.body.absolutePath);
          if (!read || read.error || !read.data) {
            throw new Error(read?.error || `Failed to read local file: ${fileEntry.body.absolutePath}`);
          }
          body = new Blob([read.data]);
        }
        await uploadFileToPath(body, targetPath(fileEntry.relativePath), tabId, overwrite === true ? versions.get(fileEntry.relativePath) ?? null : null, {
          signal: options?.signal,
          onProgress: (loaded, total) => options?.onProgress?.(fileEntry.relativePath, loaded, total),
        });
        importedFiles++;
      }
      finalized = true;
      return {
        importedFiles,
        importedDirs: manifest.entries.filter((entry) => entry.kind === 'dir').length,
      };
    } catch (error) {
      await cancel();
      throw error;
    }
  };

  return {
    conflicts,
    fileCount: manifest.uploads.length,
    dirCount: manifest.entries.filter((entry) => entry.kind === 'dir').length,
    targetDir,
    commit,
    cancel,
  };
}

export async function prepareTreeImportFromFiles(targetDir: string, files: File[], workspaceTabId?: string): Promise<PreparedTreeImport> {
  const manifest = buildTreeImportManifest(collectTreeImportEntriesFromFiles(files));
  return createPreparedTreeImport(targetDir, { entries: manifest.entries, uploads: manifest.files.map(entry => ({ relativePath: entry.relativePath, body: { kind: 'file', file: entry.file } })) }, workspaceTabId);
}

export async function prepareTreeImport(
  targetDir: string,
  dataTransfer: DataTransfer,
  workspaceTabId?: string,
): Promise<PreparedTreeImport> {
  const manifest = await collectDroppedEntries(dataTransfer);
  return createPreparedTreeImport(
    targetDir,
    {
      entries: manifest.entries,
      uploads: manifest.files.map((fileEntry) => ({
        relativePath: fileEntry.relativePath,
        body: { kind: 'file', file: fileEntry.file },
      })),
    },
    workspaceTabId,
  );
}

export async function prepareTreeImportFromLocalPaths(
  targetDir: string,
  absolutePaths: string[],
  workspaceTabId?: string,
): Promise<PreparedTreeImport> {
  const collected = await window.hulala?.collectLocalTreeImport?.(absolutePaths);
  if (!collected || collected.error || !collected.entries || !collected.files) {
    throw new Error(collected?.error || 'Failed to collect local clipboard files');
  }
  return createPreparedTreeImport(
    targetDir,
    {
      entries: collected.entries,
      uploads: collected.files.map((fileEntry: { relativePath: string; absolutePath: string }) => ({
        relativePath: fileEntry.relativePath,
        body: { kind: 'local-path', absolutePath: fileEntry.absolutePath },
      })),
    },
    workspaceTabId,
  );
}

export async function readNativeClipboardFilePaths(): Promise<string[]> {
  try {
    const paths = await window.hulala?.clipboard?.readFilePaths?.();
    return Array.isArray(paths) ? paths.filter((path) => typeof path === 'string' && path.trim()) : [];
  } catch {
    return [];
  }
}
