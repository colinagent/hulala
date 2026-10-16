import assert from 'node:assert/strict';
import test from 'node:test';

import { findMarkdownTagRanges } from './markdownTag';

test('finds CJK, ASCII, and nested Markdown tags', () => {
  const text = '#认知 #math #项目/灵感';
  assert.deepEqual(findMarkdownTagRanges(text), [
    { from: 0, to: 3, label: '认知' },
    { from: 4, to: 9, label: 'math' },
    { from: 10, to: 16, label: '项目/灵感' },
  ]);
});

test('does not treat headings or word fragments as tags', () => {
  assert.deepEqual(findMarkdownTagRanges('# Heading\nmail#tag'), []);
});

test('omits tags inside Markdown ranges already claimed by another renderer', () => {
  const text = '`#code` and #visible';
  assert.deepEqual(findMarkdownTagRanges(text, [{ from: 0, to: 7 }]), [
    { from: 12, to: 20, label: 'visible' },
  ]);
});
