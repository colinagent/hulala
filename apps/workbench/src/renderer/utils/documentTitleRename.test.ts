import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMarkdownDocumentRenameTarget } from './documentTitleRename.ts';

test('document title rename preserves directory and exact Markdown extension', () => {
  assert.deepEqual(buildMarkdownDocumentRenameTarget('/notes/通用英语.md', ' 商务 英语 '), {
    ok: true,
    filePath: '/notes/商务 英语.md',
    title: '商务 英语',
    unchanged: false,
  });
  assert.deepEqual(buildMarkdownDocumentRenameTarget('/notes/readme.MARKDOWN', 'Guide'), {
    ok: true,
    filePath: '/notes/Guide.MARKDOWN',
    title: 'Guide',
    unchanged: false,
  });
});

test('document title rename rejects unsafe names without changing the extension', () => {
  assert.deepEqual(
    buildMarkdownDocumentRenameTarget('/notes/Guide.md', 'Guide'),
    { ok: true, filePath: '/notes/Guide.md', title: 'Guide', unchanged: true },
  );
  assert.deepEqual(buildMarkdownDocumentRenameTarget('/notes/Guide.md', '   '), {
    ok: false,
    reason: 'required',
  });
  assert.deepEqual(buildMarkdownDocumentRenameTarget('/notes/Guide.md', '../Guide'), {
    ok: false,
    reason: 'path-separator',
  });
  assert.deepEqual(buildMarkdownDocumentRenameTarget('/notes/Guide.md', 'folder\\Guide'), {
    ok: false,
    reason: 'path-separator',
  });
  assert.deepEqual(buildMarkdownDocumentRenameTarget('/notes/Guide.txt', 'Guide'), {
    ok: false,
    reason: 'invalid',
  });
});
