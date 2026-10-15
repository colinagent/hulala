import assert from 'node:assert/strict';
import test from 'node:test';

const {
  buildUniqueCopyName,
  canMoveOrCopyIntoTarget,
  dedupeTopLevelItems,
  prepareFileTreeTransferOps,
} =
  // @ts-ignore Node strip-types test runner requires explicit .ts extensions here.
  await import('./fileTreeTransfer.ts');

test('buildUniqueCopyName follows vscode-style suffixing', () => {
  const existing = new Set(['a.txt', 'a copy.txt', 'a copy 2.txt', 'folder', 'folder copy']);
  assert.equal(buildUniqueCopyName('a.txt', existing), 'a copy 3.txt');
  assert.equal(buildUniqueCopyName('folder', existing), 'folder copy 2');
  assert.equal(buildUniqueCopyName('.env', new Set(['.env'])), '.env copy');
});

test('dedupeTopLevelItems removes descendants when parent is selected', () => {
  assert.deepEqual(
    dedupeTopLevelItems([
      { path: '/ws/a', isDir: true },
      { path: '/ws/a/b.txt', isDir: false },
      { path: '/ws/c.txt', isDir: false },
    ]),
    [
      { path: '/ws/a', isDir: true },
      { path: '/ws/c.txt', isDir: false },
    ],
  );
});

test('canMoveOrCopyIntoTarget blocks self and descendant drops', () => {
  assert.equal(canMoveOrCopyIntoTarget([{ path: '/ws/a', isDir: true }], '/ws/a', false).ok, false);
  assert.equal(canMoveOrCopyIntoTarget([{ path: '/ws/a', isDir: true }], '/ws/a/b', false).ok, false);
  assert.equal(canMoveOrCopyIntoTarget([{ path: '/ws/a.txt', isDir: false }], '/ws', false).ok, true);
  assert.equal(canMoveOrCopyIntoTarget([{ path: '/ws/a.txt', isDir: false }], '/other', false).ok, true);
});

test('prepareFileTreeTransferOps auto-suffixes conflicts and skips no-op moves', () => {
  const ops = prepareFileTreeTransferOps({
    items: [
      { path: '/src/a.txt', isDir: false },
      { path: '/src/folder', isDir: true },
    ],
    targetDir: '/dst',
    targetEntries: [
      { name: 'a.txt', isDir: false, size: 0, modTime: 0 },
      { name: 'folder', isDir: true, size: 0, modTime: 0 },
    ],
    isCopy: true,
  });

  assert.deepEqual(
    ops.map((op: { targetPath: string }) => op.targetPath),
    ['/dst/a copy.txt', '/dst/folder copy'],
  );

  const noOps = prepareFileTreeTransferOps({
    items: [{ path: '/dst/already.txt', isDir: false }],
    targetDir: '/dst',
    targetEntries: [{ name: 'already.txt', isDir: false, size: 0, modTime: 0 }],
    isCopy: false,
  });
  assert.equal(noOps.length, 0);
});
