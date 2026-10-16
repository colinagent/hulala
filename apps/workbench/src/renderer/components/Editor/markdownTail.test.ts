import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureEditableMarkdownTail,
  getEditableMarkdownTailAppend,
} from './markdownTail.ts';

test('editable markdown tail leaves empty documents untouched', () => {
  assert.equal(getEditableMarkdownTailAppend(''), '');
  assert.equal(ensureEditableMarkdownTail(''), '');
});

test('editable markdown tail creates a real blank line after terminal content', () => {
  assert.equal(ensureEditableMarkdownTail('![image](./image.png)'), '![image](./image.png)\n\n');
  assert.equal(ensureEditableMarkdownTail('![image](./image.png)\n'), '![image](./image.png)\n\n');
});

test('editable markdown tail is idempotent and preserves extra whitespace', () => {
  assert.equal(ensureEditableMarkdownTail('paragraph\n\n'), 'paragraph\n\n');
  assert.equal(ensureEditableMarkdownTail('paragraph\n\n\n'), 'paragraph\n\n\n');
});
