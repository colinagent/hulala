import type { EditorState } from '@codemirror/state';

export function getBlockReplacementTo(state: EditorState, from: number, to: number): number {
  if (to >= state.doc.length) {
    return to;
  }
  const nextChar = state.doc.sliceString(to, to + 1);
  if (nextChar !== '\n') {
    return to;
  }
  const endLine = state.doc.lineAt(Math.max(from, to));
  // Consume the trailing newline so the widget owns the whole visual line, but
  // stop before the next line's content.
  return endLine.to === to ? to + 1 : to;
}
