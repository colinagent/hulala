import { EditorState, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { shouldCollapseFrontmatterYaml } from '../../../utils/frontmatterPanelState';
import {
  resolveFirstEditableMarkdownPosition as resolveFirstEditableMarkdownPositionFromState,
  type FirstEditableMarkdownPosition,
} from './documentLeadInPosition';
import { getFrontmatterInfo } from './utils/frontmatter';

export type { FirstEditableMarkdownPosition } from './documentLeadInPosition';

/** Resolve the first visible body line without placing the caret in collapsed YAML. */
export function resolveFirstEditableMarkdownPosition(
  state: EditorState,
  collapseFrontmatter = shouldCollapseFrontmatterYaml(state),
): FirstEditableMarkdownPosition {
  const frontmatter = getFrontmatterInfo(state);
  return resolveFirstEditableMarkdownPositionFromState(state, frontmatter, collapseFrontmatter);
}

/** Focus the first editable Markdown body line, materializing one only when needed. */
export function moveCursorToFirstEditableMarkdownPosition(view: EditorView): boolean {
  if (view.state.facet(EditorState.readOnly)) {
    return false;
  }
  const target = resolveFirstEditableMarkdownPosition(view.state);
  const end = view.state.doc.length;
  view.dispatch({
    ...(target.insert ? { changes: { from: end, to: end, insert: target.insert } } : {}),
    selection: { anchor: target.position },
    annotations: target.insert
      ? Transaction.userEvent.of('input')
      : Transaction.userEvent.of('select.pointer'),
  });
  view.focus();
  return true;
}

export function firstEditableMarkdownTop(view: EditorView): number | null {
  const target = resolveFirstEditableMarkdownPosition(view.state);
  const coords = view.coordsAtPos(Math.min(target.position, view.state.doc.length), 1);
  if (coords) {
    return coords.top;
  }
  const contentRect = view.contentDOM.getBoundingClientRect();
  return Number.isFinite(contentRect.top) ? contentRect.top : null;
}
