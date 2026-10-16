import assert from 'node:assert/strict';
import test from 'node:test';

const {
  createTreeAutoExpandScheduler,
  resolveDropTargetDir,
} =
  // @ts-ignore Node strip-types test runner requires explicit .ts extensions here.
  await import('./treeImportDrop.ts');

test('resolveDropTargetDir routes file rows to the parent directory', () => {
  assert.equal(
    resolveDropTargetDir({
      kind: 'entry',
      path: '/workspace/demo.txt',
      parentDir: '/workspace',
      isDir: false,
    }),
    '/workspace',
  );
});

test('resolveDropTargetDir keeps directory rows and blank areas on their own directory', () => {
  assert.equal(
    resolveDropTargetDir({
      kind: 'entry',
      path: '/workspace/folder',
      parentDir: '/workspace',
      isDir: true,
    }),
    '/workspace/folder',
  );
  assert.equal(
    resolveDropTargetDir({
      kind: 'blank',
      dir: '/workspace',
    }),
    '/workspace',
  );
});

test('createTreeAutoExpandScheduler reuses and cancels pending timers explicitly', () => {
  const expanded: string[] = [];
  let callback: (() => void) | null = null;
  let cleared = 0;

  const scheduler = createTreeAutoExpandScheduler(
    (dir) => expanded.push(dir),
    650,
    {
      setTimeoutFn: (nextCallback) => {
        callback = nextCallback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {
        cleared += 1;
        callback = null;
      },
    },
  );

  scheduler.schedule('/workspace/a');
  scheduler.schedule('/workspace/a');
  assert.equal(cleared, 0);

  scheduler.schedule('/workspace/b');
  assert.equal(cleared, 1);
  assert.equal(scheduler.getPendingDir(), '/workspace/b');

  assert.notEqual(callback, null);
  (callback as unknown as (() => void))();
  assert.deepEqual(expanded, ['/workspace/b']);

  scheduler.schedule('/workspace/c');
  scheduler.cancel();
  assert.equal(callback, null);
});
