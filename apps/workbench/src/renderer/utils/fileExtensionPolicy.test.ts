import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getNormalizedFileExtension,
  isFileExtensionOpenable,
} from './fileExtensionPolicy.ts';

test('file extensions normalize across case and path styles', () => {
  assert.equal(getNormalizedFileExtension('/books/BOOK.EPUB'), '.epub');
  assert.equal(getNormalizedFileExtension('C:\\notes\\README.MD'), '.md');
  assert.equal(getNormalizedFileExtension('/repo/Makefile'), '');
});

test('openable extension policy is case-insensitive while preserving empty-list behavior', () => {
  assert.equal(isFileExtensionOpenable('/books/BOOK.EPUB', ['.epub']), true);
  assert.equal(isFileExtensionOpenable('/books/book.epub', ['.EPUB']), true);
  assert.equal(isFileExtensionOpenable('/notes/readme.MD', [' .md ']), true);
  assert.equal(isFileExtensionOpenable('/notes/readme.txt', ['.md']), false);
  assert.equal(isFileExtensionOpenable('/any/unknown.bin', []), true);
});
