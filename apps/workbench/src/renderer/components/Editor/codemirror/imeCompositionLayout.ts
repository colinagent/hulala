import {
  StateEffect,
  StateField,
  Transaction,
  type Extension,
} from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { refreshLivePreviewDecorationsEffect } from './livePreviewDecorationEffects';

const COMPOSITION_LINE_CLASS = 'cm-ime-composition-line';
const COMPOSITION_LINE_HEIGHT_VAR = '--op-ime-composition-line-height';

type CompositionLineLock = {
  pos: number;
  height: number;
};

const setCompositionLineLockEffect = StateEffect.define<CompositionLineLock | null>({
  map(value, changes) {
    return value
      ? { ...value, pos: changes.mapPos(value.pos) }
      : null;
  },
});

const compositionLineLockField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setCompositionLineLockEffect)) {
        continue;
      }
      if (!effect.value) {
        next = Decoration.none;
        continue;
      }
      const pos = Math.max(0, Math.min(effect.value.pos, transaction.state.doc.length));
      next = Decoration.set([
        Decoration.line({
          class: COMPOSITION_LINE_CLASS,
          attributes: {
            style: `${COMPOSITION_LINE_HEIGHT_VAR}: ${effect.value.height}px`,
          },
        }).range(transaction.state.doc.lineAt(pos).from),
      ]);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function closestCodeMirrorLine(node: Node | null): HTMLElement | null {
  const element = node?.nodeType === 1
    ? node as HTMLElement
    : node?.parentElement ?? null;
  return element?.closest<HTMLElement>('.cm-line') ?? null;
}

function codeMirrorLineAtSelection(view: EditorView): HTMLElement | null {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const dom = view.domAtPos(head, head === line.from ? 1 : -1);
  const directLine = closestCodeMirrorLine(dom.node);
  if (directLine && view.contentDOM.contains(directLine)) {
    return directLine;
  }

  // Empty lines and positions at a block boundary can resolve to the content
  // element itself. In that case inspect the DOM child at the returned offset.
  const child = dom.node.childNodes[dom.offset] ?? dom.node.childNodes[dom.offset - 1] ?? null;
  const childLine = closestCodeMirrorLine(child);
  return childLine && view.contentDOM.contains(childLine) ? childLine : null;
}

class ImeCompositionLayoutPlugin {
  private releaseFrame: number | null = null;
  private destroyed = false;

  constructor(private readonly view: EditorView) {}

  start(): void {
    if (!this.view.lineWrapping) {
      return;
    }
    this.cancelRelease();

    const line = codeMirrorLineAtSelection(this.view);
    const height = line?.getBoundingClientRect().height ?? 0;
    if (!line || !Number.isFinite(height) || height <= 0) {
      return;
    }

    // A contenteditable IME inserts its pre-edit string directly into the
    // rendered line. Pinyin can be much wider than the committed CJK text and
    // repeatedly add/remove a soft-wrapped row. Keep the logical line's block
    // size stable until composition commits so the document below it does not
    // bounce on every compositionupdate.
    this.view.dispatch({
      effects: setCompositionLineLockEffect.of({
        pos: this.view.state.selection.main.head,
        height,
      }),
      annotations: Transaction.addToHistory.of(false),
    });
    this.view.requestMeasure();
  }

  finish(): void {
    this.cancelRelease();
    this.releaseFrame = (this.view.dom.ownerDocument.defaultView ?? window).requestAnimationFrame(() => {
      this.releaseFrame = null;
      if (this.destroyed) {
        return;
      }
      this.view.dispatch({
        effects: [
          setCompositionLineLockEffect.of(null),
          refreshLivePreviewDecorationsEffect.of(null),
        ],
        annotations: Transaction.addToHistory.of(false),
      });
      this.view.requestMeasure();
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelRelease();
  }

  private cancelRelease(): void {
    if (this.releaseFrame === null) {
      return;
    }
    (this.view.dom.ownerDocument.defaultView ?? window).cancelAnimationFrame(this.releaseFrame);
    this.releaseFrame = null;
  }
}

export function imeCompositionLayout(): Extension {
  return [
    compositionLineLockField,
    ViewPlugin.fromClass(ImeCompositionLayoutPlugin, {
      eventHandlers: {
        compositionstart() {
          this.start();
          return false;
        },
        compositionend() {
          this.finish();
          return false;
        },
        blur() {
          this.finish();
          return false;
        },
      },
    }),
  ];
}
