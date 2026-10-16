import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Text,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { subscribeEditorFontSize } from './editorMouseWheelZoom';
import { parseListLinePrefix } from './utils/listPrefix';

const HANGING_INDENT_CLASS = 'cm-md-list-hanging-indent';
const LIST_LINE_SELECTOR = '.cm-line.cm-md-list-line';
const LIST_MARKER_SELECTOR = '.cm-md-list-marker-source';

type ListIndentMeasurement = {
  lineFrom: number;
  prefixWidth: number;
};

type ListIndentDecorationUpdate = {
  reset: boolean;
  measurements: ListIndentMeasurement[];
};

const setListHangingIndentsEffect = StateEffect.define<ListIndentDecorationUpdate>();

function buildListHangingIndentDecorations(
  doc: Text,
  measurements: readonly ListIndentMeasurement[],
): Range<Decoration>[] {
  return measurements.flatMap(({ lineFrom, prefixWidth }) => {
    if (lineFrom < 0 || lineFrom > doc.length) {
      return [];
    }
    const line = doc.lineAt(lineFrom);
    if (line.from !== lineFrom || !parseListLinePrefix(line.text)) {
      return [];
    }

    const width = `${prefixWidth.toFixed(3)}px`;
    return [
      Decoration.line({
        class: HANGING_INDENT_CLASS,
        attributes: {
          style: `--op-md-list-prefix-width:${width};--op-md-list-prefix-offset:-${width}`,
        },
      }).range(lineFrom),
    ];
  });
}

const listHangingIndentField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    if (transaction.docChanged) {
      removeDecorationsFromChangedLines(transaction, (from, to) => {
        next = next.update({
          filter: (position) => position < from || position > to,
          filterFrom: from,
          filterTo: to,
        });
      });
    }
    for (const effect of transaction.effects) {
      if (effect.is(setListHangingIndentsEffect)) {
        if (effect.value.reset) {
          next = Decoration.none;
        }
        const replacedLines = new Set(
          effect.value.measurements.map(({ lineFrom }) => lineFrom),
        );
        if (replacedLines.size > 0) {
          const firstReplacedLine = Math.min(...replacedLines);
          const lastReplacedLine = Math.max(...replacedLines);
          next = next.update({
            filter: (from) => !replacedLines.has(from),
            filterFrom: firstReplacedLine,
            filterTo: lastReplacedLine,
            add: buildListHangingIndentDecorations(
              transaction.state.doc,
              effect.value.measurements,
            ),
            sort: true,
          });
        }
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function removeDecorationsFromChangedLines(
  transaction: Transaction,
  remove: (from: number, to: number) => void,
): void {
  transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const firstLineFrom = transaction.state.doc.lineAt(fromB).from;
    const lastLineFrom = transaction.state.doc.lineAt(toB).from;
    remove(firstLineFrom, lastLineFrom);
  });
}

function hasListHangingIndentAt(decorations: DecorationSet, lineFrom: number): boolean {
  const cursor = decorations.iter(lineFrom);
  return cursor.value !== null && cursor.from === lineFrom;
}

function taskListLineStartsAtSelection(state: EditorState): Set<number> {
  const selection = state.selection.main;
  return new Set([
    state.doc.lineAt(selection.anchor).from,
    state.doc.lineAt(selection.head).from,
  ]);
}

function isTaskMarkerActive(state: EditorState, lineFrom: number): boolean {
  if (lineFrom < 0 || lineFrom > state.doc.length) {
    return false;
  }
  const line = state.doc.lineAt(lineFrom);
  const parsed = parseListLinePrefix(line.text);
  if (
    line.from !== lineFrom
    || parsed?.taskMarkerFrom == null
    || parsed.taskMarkerTo == null
  ) {
    return false;
  }

  const markerStart = line.from + parsed.taskMarkerFrom;
  const markerEnd = line.from + parsed.taskMarkerTo;
  const nearMarker = (position: number) => (
    position >= markerStart - 1 && position <= markerEnd
  );
  const selection = state.selection.main;
  return nearMarker(selection.anchor) || nearMarker(selection.head);
}

function getLineElementAt(view: EditorView, position: number): HTMLElement | null {
  const { node } = view.domAtPos(position, 1);
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as HTMLElement
    : node.parentElement;
  const line = element?.closest(LIST_LINE_SELECTOR);
  return line instanceof HTMLElement ? line : null;
}

function measureVisibleListIndents(
  view: EditorView,
  decorations: DecorationSet,
  forcedLines: ReadonlySet<number>,
): ListIndentMeasurement[] {
  const measurements: ListIndentMeasurement[] = [];
  const firstLine = view.state.doc.lineAt(view.viewport.from).number;
  const lastLine = view.state.doc.lineAt(view.viewport.to).number;

  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const parsed = parseListLinePrefix(line.text);
    if (
      !parsed
      || (
        !forcedLines.has(line.from)
        && hasListHangingIndentAt(decorations, line.from)
      )
    ) {
      continue;
    }

    // Continuation paragraphs share cm-md-list-line, but only an actual list
    // item start owns a marker. Never change the layout of continuation lines.
    const element = getLineElementAt(view, line.from);
    if (!element?.querySelector(LIST_MARKER_SELECTOR)) {
      continue;
    }

    const contentPosition = line.from + (parsed.taskContentFrom ?? parsed.markerTo);
    const lineStart = view.coordsAtPos(line.from, 1);
    const contentStart = view.coordsAtPos(contentPosition, -1);
    if (!lineStart || !contentStart) {
      continue;
    }

    const prefixWidth = (contentStart.left - lineStart.left) / view.scaleX;
    if (Number.isFinite(prefixWidth) && prefixWidth > 0) {
      measurements.push({ lineFrom: line.from, prefixWidth });
    }
  }

  return measurements;
}

class ListHangingIndentPluginValue {
  private readonly measureKey = {};
  private readonly unsubscribeFontSize: () => void;
  private readonly pendingMeasurements = new Map<number, number>();
  private readonly forcedLines = new Set<number>();
  private pendingDoc: Text | null = null;
  private pendingReset = false;
  private syncQueued = false;
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    this.unsubscribeFontSize = subscribeEditorFontSize(() => {
      this.queueDecorationSync(this.view.state.doc, [], true);
    });
    this.requestMeasurement();
  }

  update(update: ViewUpdate): void {
    let taskMarkerGeometryChanged = false;
    if (update.docChanged) {
      this.forcedLines.clear();
    } else if (update.selectionSet) {
      const candidateLines = new Set([
        ...taskListLineStartsAtSelection(update.startState),
        ...taskListLineStartsAtSelection(update.state),
      ]);
      for (const lineFrom of candidateLines) {
        if (
          isTaskMarkerActive(update.startState, lineFrom)
          !== isTaskMarkerActive(update.state, lineFrom)
        ) {
          this.forcedLines.add(lineFrom);
          taskMarkerGeometryChanged = true;
        }
      }
    }
    if (
      update.docChanged
      || update.viewportChanged
      || update.geometryChanged
      || taskMarkerGeometryChanged
    ) {
      this.requestMeasurement();
    }
  }

  docViewUpdate(): void {
    this.requestMeasurement();
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribeFontSize();
    this.forcedLines.clear();
  }

  private requestMeasurement(): void {
    this.view.requestMeasure({
      key: this.measureKey,
      read: (measuredView) => measureVisibleListIndents(
        measuredView,
        measuredView.state.field(listHangingIndentField),
        this.forcedLines,
      ),
      write: (measurements) => {
        if (measurements.length === 0) {
          return;
        }
        for (const measurement of measurements) {
          this.forcedLines.delete(measurement.lineFrom);
        }
        this.queueDecorationSync(this.view.state.doc, measurements, false);
      },
    });
  }

  private queueDecorationSync(
    measuredDoc: Text,
    measurements: readonly ListIndentMeasurement[],
    reset: boolean,
  ): void {
    if (this.pendingDoc !== measuredDoc) {
      this.pendingDoc = measuredDoc;
      this.pendingMeasurements.clear();
      this.pendingReset = false;
    }
    if (reset) {
      this.pendingReset = true;
      this.pendingMeasurements.clear();
    }
    for (const measurement of measurements) {
      this.pendingMeasurements.set(measurement.lineFrom, measurement.prefixWidth);
    }

    if (!this.syncQueued) {
      this.syncQueued = true;
      queueMicrotask(() => this.flushDecorationSync());
    }
  }

  private flushDecorationSync(): void {
    this.syncQueued = false;
    if (this.destroyed) {
      return;
    }
    const measuredDoc = this.pendingDoc;
    if (!measuredDoc || this.view.state.doc !== measuredDoc) {
      const resetForCurrentDocument = this.pendingReset;
      this.pendingDoc = null;
      this.pendingMeasurements.clear();
      this.pendingReset = false;
      if (resetForCurrentDocument) {
        this.queueDecorationSync(this.view.state.doc, [], true);
      } else {
        this.requestMeasurement();
      }
      return;
    }

    const update: ListIndentDecorationUpdate = {
      reset: this.pendingReset,
      measurements: Array.from(
        this.pendingMeasurements,
        ([lineFrom, prefixWidth]) => ({ lineFrom, prefixWidth }),
      ),
    };
    this.pendingDoc = null;
    this.pendingMeasurements.clear();
    this.pendingReset = false;
    this.view.dispatch({ effects: setListHangingIndentsEffect.of(update) });
    if (update.reset) {
      this.requestMeasurement();
    }
  }
}

export function listHangingIndent(): Extension[] {
  return [
    listHangingIndentField,
    ViewPlugin.fromClass(ListHangingIndentPluginValue),
  ];
}
