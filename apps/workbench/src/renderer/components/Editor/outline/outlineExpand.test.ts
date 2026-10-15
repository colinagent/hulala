import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterVisibleOutlineNodes,
  getAncestorAutoExpandedIds,
  resolveExpandedIds,
} from './outlineExpand.ts';
import type { OutlineNode } from './outlineTypes.ts';

function node(
  id: string,
  depth: number,
  hasChildren: boolean,
  ancestorIds: string[] = [],
  parentId: string | null = ancestorIds[ancestorIds.length - 1] ?? null,
): OutlineNode {
  return { id, label: id, depth, hasChildren, parentId, ancestorIds };
}

const tree: OutlineNode[] = [
  node('root-a', 0, true),
  node('child-a1', 1, true, ['root-a']),
  node('child-a1-1', 2, false, ['root-a', 'child-a1']),
  node('root-b', 0, true),
  node('child-b1', 1, false, ['root-b']),
];

test('default collapsed visibility shows only depth-0 nodes', () => {
  const visible = filterVisibleOutlineNodes(tree, new Set());
  assert.deepEqual(visible.map((entry) => entry.id), ['root-a', 'root-b']);
});

test('expanding a root reveals only its direct children until deeper expand', () => {
  const visible = filterVisibleOutlineNodes(tree, new Set(['root-a']));
  assert.deepEqual(visible.map((entry) => entry.id), ['root-a', 'child-a1', 'root-b']);
});

test('ancestor auto-expand does not expand siblings or the active node itself', () => {
  const map = new Map(tree.map((entry) => [entry.id, entry]));
  const auto = getAncestorAutoExpandedIds('child-a1-1', map);
  assert.deepEqual([...auto].sort(), ['child-a1', 'root-a']);
  assert.equal(auto.has('child-a1-1'), false);
  assert.equal(auto.has('root-b'), false);
});

test('manual collapse wins over auto-expand', () => {
  const resolved = resolveExpandedIds(
    new Set(['root-a', 'child-a1']),
    new Set(),
    new Set(['root-a']),
  );
  assert.deepEqual([...resolved], ['child-a1']);
});
