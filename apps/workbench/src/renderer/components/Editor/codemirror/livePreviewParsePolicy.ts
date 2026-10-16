import { syntaxTreeAvailable } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

/** Whether live preview may apply replace/hide decorations at `visibleTo`. */
export function resolveLivePreviewReplacePolicy(state: EditorState, visibleTo: number): boolean {
  if (visibleTo <= 0) {
    return true;
  }
  return syntaxTreeAvailable(state, visibleTo);
}

export function getVisibleDocBounds(
  visibleRanges: ReadonlyArray<{ from: number; to: number }>,
  docLength: number
): { from: number; to: number } {
  let from = docLength;
  let to = 0;
  for (const range of visibleRanges) {
    from = Math.min(from, range.from);
    to = Math.max(to, range.to);
  }
  if (to === 0) {
    return { from: 0, to: 0 };
  }
  return { from, to };
}
