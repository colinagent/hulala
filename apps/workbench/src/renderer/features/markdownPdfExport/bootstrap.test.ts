import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMarkdownPdfExportBootstrapState } from './bootstrap';

test('uses the source path as the export document path when present', () => {
  const result = buildMarkdownPdfExportBootstrapState({
    title: 'Guide',
    content: '# Guide',
    sourcePath: '/workspace/docs/guide.md',
    currentDir: '/workspace/docs',
    instanceID: 'instance-1',
  });

  assert.equal(result.documentPath, '/workspace/docs/guide.md');
  assert.equal(result.appStatePatch.currentFilePath, '/workspace/docs/guide.md');
  assert.equal(result.appStatePatch.currentFileURI, 'opfs://instance-1/workspace/docs/guide.md');
});

test('builds a synthetic markdown path for unsaved documents in the current dir', () => {
  const result = buildMarkdownPdfExportBootstrapState({
    title: 'Draft Export',
    content: 'hello',
    currentDir: '/workspace/notes',
  });

  assert.equal(result.documentPath, '/workspace/notes/Draft Export.md');
  assert.equal(result.appStatePatch.currentDir, '/workspace/notes');
  assert.equal(result.appStatePatch.currentFilePath, '/workspace/notes/Draft Export.md');
});

test('falls back to a local authority when no instance id exists', () => {
  const result = buildMarkdownPdfExportBootstrapState({
    title: 'Untitled',
    content: '',
    currentDir: '/workspace',
  });

  assert.equal(result.appStatePatch.currentFileURI, 'opfs://local%3Adefault/workspace/Untitled.md');
});
