import assert from 'node:assert/strict';
import test from 'node:test';
import type { Root } from 'react-dom/client';
import { deferReactRootUnmount } from './reactRootLifecycle.ts';

test('deferReactRootUnmount waits until the current React commit can finish', async () => {
  let unmountCalls = 0;

  deferReactRootUnmount({
    unmount: () => {
      unmountCalls += 1;
    },
  } as unknown as Root);

  assert.equal(unmountCalls, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(unmountCalls, 1);
});

test('deferReactRootUnmount ignores an absent root', () => {
  assert.doesNotThrow(() => deferReactRootUnmount(null));
});
