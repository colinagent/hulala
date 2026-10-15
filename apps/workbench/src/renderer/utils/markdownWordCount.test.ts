import assert from 'node:assert/strict';
import test from 'node:test';

import { countMarkdownWords } from './markdownWordCount.ts';

test('countMarkdownWords counts Chinese characters individually', () => {
  assert.equal(countMarkdownWords('你好，世界！'), 4);
});

test('countMarkdownWords counts English and numeric runs as words', () => {
  assert.equal(countMarkdownWords("Hulala keeps version 2.0 user's notes"), 6);
});

test('countMarkdownWords ignores whitespace and Markdown punctuation', () => {
  assert.equal(countMarkdownWords('# 标题\n\n**Hulala** _notes_'), 4);
  assert.equal(countMarkdownWords('  \n\t'), 0);
});
