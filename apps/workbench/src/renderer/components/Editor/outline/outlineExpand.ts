import type { OutlineNode } from './outlineTypes';

export function filterVisibleOutlineNodes(
  nodes: OutlineNode[],
  expandedIds: Set<string>,
): OutlineNode[] {
  return nodes.filter((node) => node.ancestorIds.every((ancestorId) => expandedIds.has(ancestorId)));
}

export function normalizeExpandedIds(
  nodes: OutlineNode[],
  expandedIds: Set<string>,
): Set<string> {
  const expandableIds = new Set(nodes.filter((node) => node.hasChildren).map((node) => node.id));
  const nextExpandedIds = new Set<string>();
  for (const id of expandedIds) {
    if (expandableIds.has(id)) {
      nextExpandedIds.add(id);
    }
  }
  return nextExpandedIds;
}

export function resolveExpandedIds(
  autoExpandedIds: Set<string>,
  manualExpandedIds: Set<string>,
  manualCollapsedIds: Set<string>,
): Set<string> {
  const resolved = new Set<string>(autoExpandedIds);
  for (const id of manualExpandedIds) {
    resolved.add(id);
  }
  for (const id of manualCollapsedIds) {
    resolved.delete(id);
  }
  return resolved;
}

/** Expand only ancestors of the active node so it can appear; never expand the whole tree. */
export function getAncestorAutoExpandedIds(
  activeId: string | null,
  nodeMap: Map<string, OutlineNode>,
): Set<string> {
  if (!activeId) {
    return new Set();
  }
  const activeNode = nodeMap.get(activeId);
  if (!activeNode) {
    return new Set();
  }

  const nextExpandedIds = new Set<string>();
  for (const ancestorId of activeNode.ancestorIds) {
    const ancestor = nodeMap.get(ancestorId);
    if (!ancestor?.hasChildren) {
      continue;
    }
    nextExpandedIds.add(ancestorId);
  }
  return nextExpandedIds;
}

export function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

export function buildOutlineNodeMap(nodes: OutlineNode[]): Map<string, OutlineNode> {
  const map = new Map<string, OutlineNode>();
  for (const node of nodes) {
    map.set(node.id, node);
  }
  return map;
}
