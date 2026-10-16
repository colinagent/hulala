import type { EditorState } from '@codemirror/state';

import { ensureEditableMarkdownTail } from '../markdownTail.ts';
import { getListItemContinuationIndentAt } from './utils/listPrefix.ts';

export type MarkdownImageInsertion = {
  insert: string;
  cursorOffset: number;
};

export function buildImageInsertion(state: EditorState, markdown: string): MarkdownImageInsertion {
  const selection = state.selection.main;
  const hasSelection = !selection.empty;
  const from = selection.from;
  const to = selection.to;
  const before = from > 0 ? state.doc.sliceString(from - 1, from) : '';
  const after = to < state.doc.length ? state.doc.sliceString(to, to + 1) : '';
  const listIndent = getListItemContinuationIndentAt(state, from) ?? '';
  let insert = markdown;
  if (!hasSelection && from > 0 && before !== '\n') {
    insert = `\n${listIndent}${insert}`;
  }
  const currentLine = state.doc.lineAt(from);
  const beforeInLine = state.doc.sliceString(currentLine.from, from);
  if (!hasSelection && listIndent && before === '\n' && beforeInLine.length === 0) {
    insert = `${listIndent}${insert}`;
  }
  if (!hasSelection && to < state.doc.length && after !== '\n') {
    insert = `${insert}\n`;
  }
  if (to >= state.doc.length) {
    insert = ensureEditableMarkdownTail(insert);
  }

  // When the source already has a following line break, land on the next
  // line instead of leaving the caret inside the image source being rendered.
  const cursorOffset = !hasSelection && to < state.doc.length && after === '\n'
    ? insert.length + 1
    : insert.length;
  return { insert, cursorOffset };
}
