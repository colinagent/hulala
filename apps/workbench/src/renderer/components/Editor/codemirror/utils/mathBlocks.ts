import { EditorState, Range } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { decorateLineRange } from './lineDecorations';
import { MathWidget } from '../widgets/MathWidget';
import { markdownMathRanges, type MarkdownMathRange } from './mathRanges';

const mathCache = new WeakMap<object, MarkdownMathRange[]>();

const MAX_MATH_SCAN_LINES = 100; // Limit how far we scan for $$ pairs (selection-based)

function isCursorOnLineOverlappingRange(state: EditorState, range: { from: number; to: number }): boolean {
  const selection = state.selection.main;
  const cursorLine = state.doc.lineAt(selection.head);
  return cursorLine.from <= range.to && cursorLine.to >= range.from;
}

export function findMathBlockAtLine(state: EditorState, lineNum: number): { from: number; to: number } | null {
  const doc = state.doc;
  const startLine = Math.max(1, lineNum - MAX_MATH_SCAN_LINES);
  const endLine = Math.min(doc.lines, lineNum + MAX_MATH_SCAN_LINES);
  let inBlock = false;
  let blockStart = 0;
  for (let i = startLine; i <= endLine; i++) {
    const line = doc.line(i);
    const idx = line.text.indexOf('$$');
    if (idx === -1) continue;
    const pos = line.from + idx;
    if (!inBlock) {
      const second = line.text.indexOf('$$', idx + 2);
      if (second !== -1) {
        const from = pos;
        const to = line.from + second + 2;
        if (lineNum === i) return { from, to };
        continue;
      }
      inBlock = true;
      blockStart = pos;
      continue;
    }
    const blockEnd = pos + 2;
    if (lineNum >= doc.lineAt(blockStart).number && lineNum <= i) {
      return { from: blockStart, to: blockEnd };
    }
    inBlock = false;
  }
  return null;
}

export function buildMathBlockDecorationsInRange(
  state: EditorState,
  rangeFrom: number,
  rangeTo: number,
  out: Range<Decoration>[],
  exportMode = false,
): void {
  let ranges = mathCache.get(state.doc);
  if (!ranges) { ranges = markdownMathRanges(state.doc.toString()); mathCache.set(state.doc, ranges); }
  for (const range of ranges) {
    if (range.to < rangeFrom || range.from > rangeTo || out.some(item => item.from === range.from && item.to === range.to && item.value.spec.widget)) continue;
    if (!exportMode && isCursorOnLineOverlappingRange(state, range)) {
      if (range.display) decorateLineRange(state, range.from, range.to, 'cm-md-math-block-line', out);
    } else {
      out.push(Decoration.replace({ widget: new MathWidget(range.formula, range.display, range.from, range.to), block: range.display }).range(range.from, range.to));
    }
  }
}
