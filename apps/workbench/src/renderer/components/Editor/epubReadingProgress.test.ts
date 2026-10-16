import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEpubSpineProgressIndex,
  formatEpubReadingProgress,
  getEpubReadingProgress,
  normalizeEpubReadingProgress,
  resolveEpubReadingProgress,
  setEpubReadingProgress,
  subscribeEpubReadingProgress,
} from './epubReadingProgress.ts';

test('EPUB reading progress prefers exact locations and clamps invalid bounds', () => {
  const index = createEpubSpineProgressIndex(new Array(10).fill(1));
  assert.equal(resolveEpubReadingProgress({ start: { percentage: 0.426 } }, index, true), 0.426);
  assert.equal(resolveEpubReadingProgress({ start: { percentage: 2 } }, index, true), 1);
  assert.equal(resolveEpubReadingProgress({ start: { percentage: -1 } }, index, true), 0);
  assert.equal(resolveEpubReadingProgress({ start: { percentage: 0.8 }, atEnd: true }, index, true), 1);
  assert.equal(normalizeEpubReadingProgress(Number.NaN), null);
});

test('EPUB reading progress rejects epub.js fake zero when locations are absent', () => {
  const index = createEpubSpineProgressIndex([100, 300, 600]);
  assert.equal(resolveEpubReadingProgress({
    start: { index: 1, percentage: 0, displayed: { page: 3, total: 4 } },
  }, index, false), 0.25);
});

test('EPUB reading progress weights spine items and falls back for missing sizes', () => {
  const index = createEpubSpineProgressIndex([100, 300, 600]);
  assert.equal(resolveEpubReadingProgress({
    start: { index: 1, displayed: { page: 3, total: 4 } },
  }, index, false), 0.25);
  assert.equal(resolveEpubReadingProgress(
    { start: { index: 2, displayed: { page: 1, total: 1 } } },
    createEpubSpineProgressIndex([1, null, 1]),
    false,
  ), 2 / 3);
  assert.equal(resolveEpubReadingProgress({ start: { index: 0 } }, index, false), 0);
  assert.equal(resolveEpubReadingProgress(
    { start: { index: 3 } },
    createEpubSpineProgressIndex([]),
    false,
  ), null);
  assert.equal(formatEpubReadingProgress(0.426), '43%');
  assert.equal(formatEpubReadingProgress(null), '—');
});

test('EPUB reading progress subscriptions are isolated by file', () => {
  const path = '/books/progress-test.epub';
  const otherPath = '/books/other-progress-test.epub';
  let notifications = 0;
  const unsubscribe = subscribeEpubReadingProgress(path, () => {
    notifications += 1;
  });

  setEpubReadingProgress(otherPath, 0.2);
  setEpubReadingProgress(path, 0.25);
  setEpubReadingProgress(path, 0.25);
  setEpubReadingProgress(path, 0.5);
  unsubscribe();
  setEpubReadingProgress(path, 0.75);

  assert.equal(notifications, 2);
  assert.equal(getEpubReadingProgress(path), 0.75);
});
