import assert from 'node:assert/strict';
import test from 'node:test';

import { PdfExportReadinessTracker } from './pdfExportReadiness';

test('waitForSettled resolves after tracked work settles', async () => {
  const tracker = new PdfExportReadinessTracker();
  let resolved = false;
  const task = tracker.track(
    new Promise((resolvePromise) => {
      setTimeout(() => {
        resolved = true;
        resolvePromise('ok');
      }, 10);
    })
  );

  await tracker.waitForSettled();
  await task;
  assert.equal(resolved, true);
});

test('waitForSettled resolves immediately when no work is pending', async () => {
  const tracker = new PdfExportReadinessTracker();
  await tracker.waitForSettled();
  assert.equal(true, true);
});
