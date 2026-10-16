import { EditorState, type SelectionRange, StateEffect, StateField } from '@codemirror/state';
import { findIndexedTableBlockAtPos, getBlockStructureIndex } from './utils/blockStructureIndex';

export const openTableSourceEffect = StateEffect.define<number>();

export function isSelectionWithinRange(
  selection: SelectionRange,
  from: number,
  to: number
): boolean {
  if (selection.empty) {
    return selection.head >= from && selection.head < to;
  }
  return selection.from >= from && selection.to <= to;
}

export function findTableRangeAtPos(state: EditorState, pos: number): { from: number; to: number } | null {
  const resolvedPos = Math.max(0, Math.min(pos, state.doc.length));
  const tableBlock = findIndexedTableBlockAtPos(getBlockStructureIndex(state), resolvedPos);
  return tableBlock ? { from: tableBlock.from, to: tableBlock.to } : null;
}

export const tableSourceBlockField = StateField.define<number | null>({
  create() {
    return null;
  },
  update(value, tr) {
    let next = value === null ? null : tr.changes.mapPos(value, 1);

    for (const effect of tr.effects) {
      if (effect.is(openTableSourceEffect)) {
        next = effect.value;
      }
    }

    if (next === null) {
      return null;
    }

    const selection = tr.state.selection.main;
    const activeTable = findTableRangeAtPos(tr.state, selection.head);
    if (!activeTable) {
      return null;
    }

    if (activeTable.from !== next) {
      return null;
    }

    return isSelectionWithinRange(selection, activeTable.from, activeTable.to) ? next : null;
  },
});
