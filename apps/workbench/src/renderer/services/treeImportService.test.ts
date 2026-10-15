import assert from 'node:assert/strict';
import test from 'node:test';

const {
  buildTreeImportManifest,
  collectTreeImportEntriesFromFileSystemEntries,
  collectTreeImportEntriesFromFiles,
  normalizeTreeImportRelativePath,
} =
  // @ts-ignore Node strip-types test runner requires explicit .ts extensions here.
  await import('./treeImportManifest.ts');

type FakeFileEntry = {
  isFile: true;
  isDirectory: false;
  name: string;
  file: (success: (file: File) => void) => void;
};

type FakeDirectoryEntry = {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader: () => {
    readEntries: (success: (entries: Array<FakeFileEntry | FakeDirectoryEntry>) => void) => void;
  };
};

function createFileEntry(name: string, content: string): FakeFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (success) => {
      success(new File([content], name, { type: 'text/plain' }));
    },
  };
}

function createDirectoryEntry(
  name: string,
  children: Array<FakeFileEntry | FakeDirectoryEntry>,
): FakeDirectoryEntry {
  let emitted = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (success) => {
        if (emitted) {
          success([]);
          return;
        }
        emitted = true;
        success(children);
      },
    }),
  };
}

test('normalizeTreeImportRelativePath rejects parent traversal', () => {
  assert.throws(
    () => normalizeTreeImportRelativePath('../bad.txt'),
    /stay within the drop root/,
  );
});

test('collectTreeImportEntriesFromFiles synthesizes parent directories for nested files', () => {
  const file = new File(['hello'], 'nested.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', {
    configurable: true,
    value: 'folder/nested.txt',
  });

  const entries = collectTreeImportEntriesFromFiles([file]);

  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.relativePath]),
    [
      ['dir', 'folder'],
      ['file', 'folder/nested.txt'],
    ],
  );
});

test('collectTreeImportEntriesFromFileSystemEntries keeps nested and empty directories', async () => {
  const emptyDir = createDirectoryEntry('empty', []);
  const rootDir = createDirectoryEntry('folder', [
    createFileEntry('child.txt', 'hello'),
    emptyDir,
  ]);

  const entries = await collectTreeImportEntriesFromFileSystemEntries([rootDir]);

  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.relativePath]),
    [
      ['dir', 'folder'],
      ['file', 'folder/child.txt'],
      ['dir', 'folder/empty'],
    ],
  );
});

test('buildTreeImportManifest dedupes duplicate file paths and keeps the first file object', () => {
  const first = new File(['one'], 'demo.txt', { type: 'text/plain' });
  const second = new File(['two'], 'demo.txt', { type: 'text/plain' });

  const result = buildTreeImportManifest([
    { kind: 'file', relativePath: 'demo.txt', file: first },
    { kind: 'file', relativePath: 'demo.txt', file: second },
  ]);

  assert.deepEqual(result.entries, [
    {
      kind: 'file',
      relativePath: 'demo.txt',
      size: 3,
    },
  ]);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].file, first);
});
