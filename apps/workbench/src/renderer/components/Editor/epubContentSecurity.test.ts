import { expect, test } from 'bun:test';
import { protectEpubDocument } from './epubContentSecurity';

test('invalid EPUB content rejects the async hook so epub.js cannot render it unprotected', async () => {
  const document = { documentElement: { localName: 'svg', namespaceURI: 'http://www.w3.org/2000/svg' } } as Document;
  const result = protectEpubDocument(document);
  expect(result).toBeInstanceOf(Promise);
  await expect(result).rejects.toThrow('The EPUB section must be an HTML document.');
});
