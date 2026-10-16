import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarkdownDocumentTitle } from './documentHeader';

test('getMarkdownDocumentTitle strips .md extension', () => {
  assert.equal(getMarkdownDocumentTitle('/notes/AGENT WIKI是什么？.md'), 'AGENT WIKI是什么？');
});

test('getMarkdownDocumentTitle strips .markdown extension case-insensitively', () => {
  assert.equal(getMarkdownDocumentTitle('/notes/readme.MARKDOWN'), 'readme');
});

test('getMarkdownDocumentTitle keeps basename when extension is not markdown', () => {
  assert.equal(getMarkdownDocumentTitle('/notes/readme.txt'), 'readme.txt');
});
