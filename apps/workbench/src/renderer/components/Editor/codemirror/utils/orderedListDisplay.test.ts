import assert from 'node:assert/strict';
import test from 'node:test';

import {
  firstOrderedListMarkerForDepth,
  nextOrderedListMarker,
  normalizeOrderedListMarker,
  normalizeOrderedListMarkersInMarkdown,
} from './orderedListDisplay';

test('stores decimal, alpha, and roman markers directly in Markdown source', () => {
  assert.equal(firstOrderedListMarkerForDepth(0), '1.');
  assert.equal(firstOrderedListMarkerForDepth(1), 'a.');
  assert.equal(firstOrderedListMarkerForDepth(2), 'i.');
  assert.equal(nextOrderedListMarker('2.', 0), '3.');
  assert.equal(nextOrderedListMarker('b.', 1), 'c.');
  assert.equal(nextOrderedListMarker('ii.', 2), 'iii.');
  assert.equal(normalizeOrderedListMarker('2.', 0, 1), 'b.');
  assert.equal(normalizeOrderedListMarker('b.', 1, 2), 'ii.');
  assert.equal(normalizeOrderedListMarker('ii.', 2, 1), 'b.');
});

test('normalizes existing nested numeric markers without touching code or frontmatter', () => {
  const source = [
    '---',
    '1. metadata',
    '---',
    '1. top',
    '  1. alpha',
    '  2. beta',
    '    1. roman',
    '    2. roman two',
    '```md',
    '  1. code',
    '```',
  ].join('\n');

  assert.equal(normalizeOrderedListMarkersInMarkdown(source), [
    '---',
    '1. metadata',
    '---',
    '1. top',
    '  a. alpha',
    '  b. beta',
    '    i. roman',
    '    ii. roman two',
    '```md',
    '  1. code',
    '```',
  ].join('\n'));
});
