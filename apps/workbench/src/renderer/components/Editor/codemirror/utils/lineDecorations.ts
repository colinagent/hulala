import { EditorState, Range } from '@codemirror/state';
import { Decoration } from '@codemirror/view';

/**
 * Add line decorations for a contiguous range (start/end get -start/-end class).
 */
export function decorateLineRange(
  state: EditorState,
  from: number,
  to: number,
  baseClass: string,
  out: Range<Decoration>[]
): void {
  const doc = state.doc;
  const startLineNum = doc.lineAt(from).number;
  const endPos = Math.max(from, Math.min(to, doc.length));
  const endLineNum = doc.lineAt(Math.max(from, endPos - 1)).number;

  for (let i = startLineNum; i <= endLineNum; i++) {
    const line = doc.line(i);
    const classes = [baseClass];
    if (i === startLineNum) classes.push(`${baseClass}-start`);
    if (i === endLineNum) classes.push(`${baseClass}-end`);
    out.push(Decoration.line({ class: classes.join(' ') }).range(line.from));
  }
}
