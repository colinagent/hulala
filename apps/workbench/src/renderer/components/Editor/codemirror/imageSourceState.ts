import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
export type ImageSourceRange = {
  from: number;
  to: number;
};

export const openImageSourceEffect = StateEffect.define<ImageSourceRange>();

function isSelectionInsideImageSourceRange(
  selection: { from: number; to: number; head: number; empty: boolean },
  from: number,
  to: number
): boolean {
  if (selection.empty) {
    return selection.head >= from && selection.head < to;
  }
  return selection.from >= from && selection.to <= to;
}

function isSelectionOnImageSourceLine(
  state: EditorState,
  selection: { from: number; to: number; head: number; empty: boolean },
  range: ImageSourceRange,
): boolean {
  const sourceLine = state.doc.lineAt(range.from);
  if (selection.empty) {
    const caretLine = state.doc.lineAt(selection.head);
    return caretLine.number === sourceLine.number;
  }
  const fromLine = state.doc.lineAt(selection.from);
  const toLine = state.doc.lineAt(Math.max(selection.from, selection.to - 1));
  return fromLine.number === sourceLine.number && toLine.number === sourceLine.number;
}

function mapImageSourceRange(
  range: ImageSourceRange,
  state: EditorState,
  tr: Transaction
): ImageSourceRange | null {
  const from = tr.changes.mapPos(range.from, 1);
  const to = tr.changes.mapPos(range.to, -1);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || from < 0 || to > state.doc.length) {
    return null;
  }
  return { from, to };
}

export function openImageSource(view: EditorView, range: ImageSourceRange): void {
  const scroller = view.scrollDOM;
  const scrollTop = scroller.scrollTop;
  const scrollLeft = scroller.scrollLeft;
  const anchorTopBefore = view.lineBlockAt(range.from).top;

  view.dispatch({
    effects: openImageSourceEffect.of(range),
    selection: { anchor: range.from },
    userEvent: 'select.pointer',
  });
  view.focus();

  view.requestMeasure({
    key: `image-source-open:${range.from}:${range.to}`,
    read: (v) => v.lineBlockAt(range.from).top,
    write: (anchorTopAfter, v) => {
      const drift = anchorTopAfter - anchorTopBefore;
      if (Math.abs(drift) > 1) {
        v.scrollDOM.scrollTop = scrollTop + drift;
      } else {
        v.scrollDOM.scrollTop = scrollTop;
      }
      v.scrollDOM.scrollLeft = scrollLeft;
    },
  });
}

export const imageSourceField = StateField.define<ImageSourceRange | null>({
  create() {
    return null;
  },
  update(value, tr) {
    let next = value ? mapImageSourceRange(value, tr.state, tr) : null;

    for (const effect of tr.effects) {
      if (effect.is(openImageSourceEffect)) {
        next = effect.value;
      }
    }

    if (!next) {
      return null;
    }

    const selection = tr.state.selection.main;
    return (
      isSelectionInsideImageSourceRange(selection, next.from, next.to)
      || isSelectionOnImageSourceLine(tr.state, selection, next)
    )
      ? next
      : null;
  },
});
