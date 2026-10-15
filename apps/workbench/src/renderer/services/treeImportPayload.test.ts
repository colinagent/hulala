import assert from 'node:assert/strict';
import test from 'node:test';

const { hasExternalTreeImportPayload } =
  // @ts-ignore Node strip-types test runner requires explicit .ts extensions here.
  await import('./treeImportPayload.ts');

function createDataTransferLike(input: {
  files?: File[];
  items?: Array<{ kind: string; type?: string }>;
  types?: string[];
  text?: string;
}): DataTransfer {
  const files = input.files ?? [];
  return {
    files: Object.assign(files, { item: (index: number) => files[index] ?? null }),
    items: input.items ?? files.map(() => ({ kind: 'file' as const })),
    types: input.types ?? (files.length > 0 ? ['Files'] : []),
    getData: (type: string) => (type === 'text/plain' ? (input.text ?? '') : ''),
  } as unknown as DataTransfer;
}

test('hasExternalTreeImportPayload accepts Finder-like clipboard files', () => {
  const dataTransfer = createDataTransferLike({
    files: [new File(['hello'], 'demo.epub', { type: 'application/epub+zip' })],
  });
  assert.equal(hasExternalTreeImportPayload(dataTransfer), true);
});

test('hasExternalTreeImportPayload rejects internal tree transfer payloads', () => {
  const dataTransfer = createDataTransferLike({
    text: 'hulala-tree-transfer',
    types: ['text/plain', 'application/x-hulala-file-tree-items'],
  });
  assert.equal(hasExternalTreeImportPayload(dataTransfer), false);
});

test('hasExternalTreeImportPayload rejects empty clipboard payloads', () => {
  const dataTransfer = createDataTransferLike({});
  assert.equal(hasExternalTreeImportPayload(dataTransfer), false);
});
