import { EditorState, Extension, Prec, StateField, Transaction } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';

import { getEditableMarkdownTailAppend } from '../markdownTail';

const EDITABLE_TAIL_SELECTOR = '[data-md-editable-tail="true"]';
const EDITABLE_TAIL_SCROLL_MEASURE_KEY = {};

class EditableTailWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'cm-md-editable-tail';
    element.dataset.mdEditableTail = 'true';
    element.setAttribute('aria-label', 'Continue writing');
    element.title = 'Continue writing';
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildEditableTailDecorations(state: EditorState): DecorationSet {
  if (state.facet(EditorState.readOnly)) {
    return Decoration.none;
  }
  return Decoration.set([
    Decoration.widget({
      widget: new EditableTailWidget(),
      block: true,
      side: 1,
    }).range(state.doc.length),
  ]);
}

const editableTailField = StateField.define<DecorationSet>({
  create: buildEditableTailDecorations,
  update: (_decorations, transaction) => buildEditableTailDecorations(transaction.state),
  provide: (field) => EditorView.decorations.from(field),
});

function eventTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Text) {
    return target.parentElement;
  }
  return null;
}

function isEditableTailPointer(event: MouseEvent, view: EditorView): boolean {
  const target = eventTargetElement(event.target);
  if (!target) {
    return false;
  }
  if (target.closest(EDITABLE_TAIL_SELECTOR)) {
    return true;
  }

  // CodeMirror's content padding is useful visual breathing room, but it does
  // not create a document position. Treat the part below our tail widget as
  // the same append surface so every visible area beneath the document works.
  if (target !== view.contentDOM && target.closest('.cm-content') !== view.contentDOM) {
    return false;
  }
  const tail = view.contentDOM.querySelector(EDITABLE_TAIL_SELECTOR);
  return Boolean(tail && event.clientY >= tail.getBoundingClientRect().top);
}

function readEditorBottomSafeAreaPx(view: EditorView): number {
  const raw = getComputedStyle(view.dom).getPropertyValue('--op-editor-bottom-safe-area').trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/**
 * Scroll just enough to keep the terminal caret above the Activity Panel safe
 * area. Never jump to the absolute bottom — that hid short-document titles.
 */
function revealEditableTailAfterLayout(view: EditorView): void {
  requestAnimationFrame(() => {
    if (!view.dom.isConnected) {
      return;
    }
    view.requestMeasure({
      key: EDITABLE_TAIL_SCROLL_MEASURE_KEY,
      read: (currentView) => {
        const scroller = currentView.scrollDOM;
        const caret = currentView.coordsAtPos(currentView.state.selection.main.head);
        if (!caret) {
          return null;
        }
        const scrollerRect = scroller.getBoundingClientRect();
        const safeArea = readEditorBottomSafeAreaPx(currentView);
        const visibleBottom = scrollerRect.bottom - safeArea;
        const overflow = caret.bottom - visibleBottom;
        if (overflow <= 0) {
          return null;
        }
        return scroller.scrollTop + overflow;
      },
      write: (nextScrollTop, currentView) => {
        if (nextScrollTop == null) {
          return;
        }
        currentView.scrollDOM.scrollTop = nextScrollTop;
      },
    });
  });
}

const keepTerminalCaretAboveOverlays = ViewPlugin.define(() => ({
  update: (update) => {
    const selection = update.state.selection.main;
    if (
      update.docChanged
      && update.view.hasFocus
      && selection.empty
      && selection.head === update.state.doc.length
    ) {
      revealEditableTailAfterLayout(update.view);
    }
  },
}));

export function moveCursorToEditableMarkdownTail(view: EditorView): void {
  if (view.state.facet(EditorState.readOnly)) {
    return;
  }
  const append = getEditableMarkdownTailAppend(view.state.doc.toString());
  const end = view.state.doc.length;
  view.dispatch({
    ...(append ? { changes: { from: end, to: end, insert: append } } : {}),
    selection: { anchor: end + append.length },
    annotations: append
      ? Transaction.userEvent.of('input')
      : Transaction.userEvent.of('select.pointer'),
  });
  view.focus();
  // Block widgets are measured after the transaction. Wait for that layout,
  // then lift the caret only if a collapsed Activity Panel covers it.
  // CodeMirror's ordinary caret scrolling cannot account for overlays because
  // the caret is technically inside the viewport even when a panel covers it.
  revealEditableTailAfterLayout(view);
}

/**
 * Adds a virtual append surface after the Markdown document. It materializes
 * a real blank paragraph only when the user clicks it, so opening a file never
 * dirties the document merely to make terminal block widgets escapable.
 */
export function editableMarkdownTail(): Extension {
  return [
    editableTailField,
    keepTerminalCaretAboveOverlays,
    Prec.highest(EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (event.button !== 0 || !isEditableTailPointer(event, view)) {
          return false;
        }
        event.preventDefault();
        moveCursorToEditableMarkdownTail(view);
        return true;
      },
    })),
  ];
}
