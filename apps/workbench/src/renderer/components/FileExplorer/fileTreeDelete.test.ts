import assert from 'node:assert/strict';
import test from 'node:test';

const {
  dedupeDeleteTargets,
  formatDeleteConfirmMessage,
} =
  // @ts-ignore Node strip-types test runner requires explicit .ts extensions here.
  await import('./fileTreeDelete.ts');

test('formats single file delete confirmation', () => {
  assert.equal(
    formatDeleteConfirmMessage([{ path: '/ws/a.png', isDir: false }]),
    'Move file to Trash?\n\n/ws/a.png',
  );
});

test('formats single folder delete confirmation', () => {
  assert.equal(
    formatDeleteConfirmMessage([{ path: '/ws/assets', isDir: true }]),
    'Move folder to Trash?\n\n/ws/assets\n\nAll contents will be moved too.',
  );
});

test('formats multiple file delete confirmation with count and paths', () => {
  assert.equal(
    formatDeleteConfirmMessage([
      { path: '/ws/a.png', isDir: false },
      { path: '/ws/b.png', isDir: false },
    ]),
    'Move 2 items to Trash?\n\n/ws/a.png\n/ws/b.png',
  );
});

test('formats mixed multi-delete confirmation with folder warning', () => {
  assert.equal(
    formatDeleteConfirmMessage([
      { path: '/ws/a.png', isDir: false },
      { path: '/ws/assets', isDir: true },
    ]),
    'Move 2 items to Trash?\n\n/ws/a.png\n/ws/assets\n\nFolder contents will be moved too.',
  );
});

test('caps multi-delete path preview', () => {
  assert.equal(
    formatDeleteConfirmMessage([
      { path: '/ws/1.txt', isDir: false },
      { path: '/ws/2.txt', isDir: false },
      { path: '/ws/3.txt', isDir: false },
      { path: '/ws/4.txt', isDir: false },
      { path: '/ws/5.txt', isDir: false },
      { path: '/ws/6.txt', isDir: false },
      { path: '/ws/7.txt', isDir: false },
    ]),
    'Move 7 items to Trash?\n\n/ws/1.txt\n/ws/2.txt\n/ws/3.txt\n/ws/4.txt\n/ws/5.txt\n/ws/6.txt\n...and 1 more',
  );
});

test('dedupes selected children under selected folders', () => {
  assert.deepEqual(
    dedupeDeleteTargets([
      { path: '/ws/assets', isDir: true },
      { path: '/ws/assets/a.png', isDir: false },
      { path: '/ws/notes.md', isDir: false },
    ]),
    [
      { path: '/ws/assets', isDir: true },
      { path: '/ws/notes.md', isDir: false },
    ],
  );
});
