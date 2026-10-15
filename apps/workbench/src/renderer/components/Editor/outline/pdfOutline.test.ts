import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPdfOutlineNodes,
  findActivePdfOutlineId,
} from './pdfOutline.ts';

const pageRef = { num: 12, gen: 0 };
const pdf = {
  getDestination: async (id: string) => id === 'chapter-two' ? [pageRef, { name: 'Fit' }] : null,
  getPageIndex: async (ref: object) => ref === pageRef ? 4 : Promise.reject(new Error('unknown ref')),
};

test('PDF outline resolves named and direct destinations while preserving hierarchy', async () => {
  const nodes = await buildPdfOutlineNodes(pdf as never, [
    {
      title: 'Part I',
      dest: [0],
      items: [
        { title: 'Chapter 1', dest: [2] },
        { title: 'Chapter 2', dest: 'chapter-two' },
      ],
    },
    { title: 'Website', url: 'https://example.com', dest: [8] },
  ]);

  assert.deepEqual(nodes.map((node) => ({
    label: node.label,
    depth: node.depth,
    page: node.page,
    parentId: node.parentId,
  })), [
    { label: 'Part I', depth: 0, page: 1, parentId: null },
    { label: 'Chapter 1', depth: 1, page: 3, parentId: nodes[0].id },
    { label: 'Chapter 2', depth: 1, page: 5, parentId: nodes[0].id },
    { label: 'Website', depth: 0, page: null, parentId: null },
  ]);
  assert.deepEqual(nodes[2].ancestorIds, [nodes[0].id]);
});

test('active PDF outline follows the nearest preceding page and deepest same-page node', async () => {
  const nodes = await buildPdfOutlineNodes(pdf as never, [
    {
      title: 'Part',
      dest: [0],
      items: [{ title: 'Chapter', dest: [0] }],
    },
    { title: 'Later', dest: [9] },
  ]);
  assert.equal(findActivePdfOutlineId(nodes, 1), nodes[1].id);
  assert.equal(findActivePdfOutlineId(nodes, 8), nodes[1].id);
  assert.equal(findActivePdfOutlineId(nodes, 10), nodes[2].id);
  assert.equal(findActivePdfOutlineId(nodes, 0), null);
});
