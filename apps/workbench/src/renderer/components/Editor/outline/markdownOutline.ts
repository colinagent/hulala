import type { OutlineTreeEntry } from '../markdownStructure';
import type { OutlineNode } from './outlineTypes';

export type MarkdownOutlineNode = OutlineNode & {
  pos: number;
  spyPos: number;
};

export function markdownEntriesToOutlineNodes(entries: OutlineTreeEntry[]): MarkdownOutlineNode[] {
  return entries.map((entry) => ({
    id: entry.id,
    label: entry.text,
    depth: entry.depth,
    hasChildren: entry.hasChildren,
    parentId: entry.parentId,
    ancestorIds: entry.ancestorIds,
    pos: entry.pos,
    spyPos: entry.spyPos,
  }));
}
