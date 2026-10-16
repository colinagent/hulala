import { expect, test } from 'bun:test';
import { canonicalFileURI, fileUrlToAbsolutePath, parseCanonicalFileURI, resolveResourcePath } from './uri';

test('resource URIs round-trip Windows drive, mixed separators, UNC and POSIX paths', () => {
  for (const [input, expected] of [
    ['C:\\Users\\reader\\中文 books/Reader #1.epub', 'C:/Users/reader/中文 books/Reader #1.epub'],
    ['d:/books/../Reader.pdf', 'D:/Reader.pdf'],
    ['C:/../../Reader.docx', 'C:/Reader.docx'],
    ['\\\\server\\share\\books\\Reader.epub', '//server/share/books/Reader.epub'],
    ['/home/reader/100% #1.epub', '/home/reader/100% #1.epub'],
    ['/home/reader/a\\b.epub', '/home/reader/a\\b.epub'],
  ]) {
    expect(parseCanonicalFileURI(canonicalFileURI('host:中文', input))).toEqual({ authorityId: 'host:中文', path: expected });
  }
});

test('file URLs retain Windows drives and network shares', () => {
  expect(fileUrlToAbsolutePath('file:///C:/books/Reader%20QA.epub')).toBe('C:/books/Reader QA.epub');
  expect(fileUrlToAbsolutePath('file://server/share/Reader.epub')).toBe('//server/share/Reader.epub');
  expect(fileUrlToAbsolutePath('file:///home/reader/Book.epub')).toBe('/home/reader/Book.epub');
});

test('drive-relative and ordinary relative resource paths are rejected', () => {
  for (const path of ['C:book.epub', 'books/book.epub', '']) expect(() => canonicalFileURI('host', path)).toThrow();
});

test('relative resources preserve volume/share roots without confusing the POSIX root with UNC', () => {
  expect(resolveResourcePath('/README.md', 'cover.png')).toBe('/cover.png');
  expect(resolveResourcePath('C:\\books\\Reader.md', 'images\\cover.png')).toBe('C:/books/images/cover.png');
  expect(resolveResourcePath('\\\\server\\share\\books\\Reader.md', '../cover.png')).toBe('//server/share/cover.png');
});
