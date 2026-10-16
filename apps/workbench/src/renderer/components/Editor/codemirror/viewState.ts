import { StateEffect, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export type CodeMirrorViewStateSnapshot = {
  selectionAnchor: number;
  selectionHead: number;
  scrollTop: number;
  scrollLeft: number;
  /** Caret Y within the viewport when it was visible at capture time. */
  selectionHeadViewportOffsetTop?: number;
  /** Document anchor used when wrapping or block widgets change pixel layout. */
  scrollAnchorPos?: number;
  scrollAnchorOffsetTop?: number;
};

export type CodeMirrorViewStateTracker = {
  get(): CodeMirrorViewStateSnapshot;
  /** Keep the trusted cache aligned after programmatic restore. */
  note(state: CodeMirrorViewStateSnapshot): void;
  destroy(): void;
};

function clampPos(pos: number, max: number): number {
  if (!Number.isFinite(pos)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.floor(pos), max));
}

function copyViewState(state: CodeMirrorViewStateSnapshot): CodeMirrorViewStateSnapshot {
  return { ...state };
}

/** Scroll geometry is only trustworthy while the editor remains in the document. */
export function hasTrustedCodeMirrorScrollGeometry(view: EditorView): boolean {
  return view.dom.isConnected && view.scrollDOM.isConnected;
}

/**
 * Prefer a previously captured snapshot when the scroller has been detached.
 * Browsers reset scrollTop to 0 on detach, which would otherwise clobber mementos
 * during cross-editor-type unmount (Markdown/Text → EPUB/PDF).
 */
export function pickTrustedCodeMirrorViewState(
  live: CodeMirrorViewStateSnapshot,
  lastTrusted: CodeMirrorViewStateSnapshot | null,
  trustedGeometry: boolean,
): CodeMirrorViewStateSnapshot {
  if (trustedGeometry || !lastTrusted) {
    return copyViewState(live);
  }
  return copyViewState(lastTrusted);
}

export function getCodeMirrorScrollAnchor(
  view: EditorView,
  scrollTop: number,
): { pos: number; offsetTop: number } | null {
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  try {
    const block = view.lineBlockAtHeight(top);
    return {
      pos: block.from,
      offsetTop: top - block.top,
    };
  } catch {
    return null;
  }
}

export function visibleCaretViewportOffsetTop(
  caret: { top: number; bottom: number } | null,
  viewport: { top: number; bottom: number },
): number | null {
  if (
    !caret
    || !Number.isFinite(caret.top)
    || !Number.isFinite(caret.bottom)
    || !Number.isFinite(viewport.top)
    || !Number.isFinite(viewport.bottom)
    || caret.bottom < viewport.top
    || caret.top > viewport.bottom
  ) {
    return null;
  }
  return caret.top - viewport.top;
}

export function scrollTopForCaretViewportOffset(
  currentScrollTop: number,
  currentCaretViewportOffsetTop: number,
  savedCaretViewportOffsetTop: number,
): number | null {
  if (
    !Number.isFinite(currentScrollTop)
    || !Number.isFinite(currentCaretViewportOffsetTop)
    || !Number.isFinite(savedCaretViewportOffsetTop)
  ) {
    return null;
  }
  return Math.max(
    0,
    currentScrollTop + currentCaretViewportOffsetTop - savedCaretViewportOffsetTop,
  );
}

export function captureCodeMirrorViewState(view: EditorView): CodeMirrorViewStateSnapshot {
  const selection = view.state.selection.main;
  const scrollTop = view.scrollDOM.scrollTop;
  const anchor = getCodeMirrorScrollAnchor(view, scrollTop);
  let caretOffsetTop: number | null = null;
  try {
    caretOffsetTop = visibleCaretViewportOffsetTop(
      view.coordsAtPos(selection.head),
      view.scrollDOM.getBoundingClientRect(),
    );
  } catch {
    // Detached or mid-update DOM geometry is not a trustworthy caret anchor.
  }
  return {
    selectionAnchor: selection.anchor,
    selectionHead: selection.head,
    scrollTop,
    scrollLeft: view.scrollDOM.scrollLeft,
    ...(caretOffsetTop === null ? {} : { selectionHeadViewportOffsetTop: caretOffsetTop }),
    scrollAnchorPos: anchor?.pos,
    scrollAnchorOffsetTop: anchor?.offsetTop,
  };
}

/**
 * Continuously remembers scroll/selection while the editor is mounted so unmount
 * cleanup can save a trusted snapshot after the scroller is detached.
 */
export function createCodeMirrorViewStateTracker(view: EditorView): CodeMirrorViewStateTracker {
  let lastTrusted = captureCodeMirrorViewState(view);

  const rememberIfTrusted = () => {
    if (!hasTrustedCodeMirrorScrollGeometry(view)) {
      return;
    }
    lastTrusted = captureCodeMirrorViewState(view);
  };

  view.scrollDOM.addEventListener('scroll', rememberIfTrusted, { passive: true });
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet || update.geometryChanged) {
          rememberIfTrusted();
        }
      }),
    ),
    annotations: Transaction.addToHistory.of(false),
  });

  return {
    get(): CodeMirrorViewStateSnapshot {
      return pickTrustedCodeMirrorViewState(
        captureCodeMirrorViewState(view),
        lastTrusted,
        hasTrustedCodeMirrorScrollGeometry(view),
      );
    },
    note(state: CodeMirrorViewStateSnapshot): void {
      lastTrusted = copyViewState(state);
    },
    destroy(): void {
      view.scrollDOM.removeEventListener('scroll', rememberIfTrusted);
    },
  };
}

const RESTORE_VIEW_STATE_MEASURE_KEY = {};

export function restoreCodeMirrorViewState(
  view: EditorView,
  state: CodeMirrorViewStateSnapshot,
): void {
  const maxPos = view.state.doc.length;
  const selectionAnchor = clampPos(state.selectionAnchor, maxPos);
  const selectionHead = clampPos(state.selectionHead, maxPos);
  const nextScrollTop = Number.isFinite(state.scrollTop) ? Math.max(0, state.scrollTop) : 0;
  const nextScrollLeft = Number.isFinite(state.scrollLeft) ? Math.max(0, state.scrollLeft) : 0;
  const selectionHeadViewportOffsetTop = Number.isFinite(state.selectionHeadViewportOffsetTop)
    ? (state.selectionHeadViewportOffsetTop as number)
    : null;
  const anchorPos = Number.isFinite(state.scrollAnchorPos)
    ? clampPos(state.scrollAnchorPos as number, maxPos)
    : null;
  const anchorOffsetTop = Number.isFinite(state.scrollAnchorOffsetTop)
    ? (state.scrollAnchorOffsetTop as number)
    : 0;

  const fallbackScrollTop = (target: EditorView): number => {
    if (anchorPos !== null) {
      try {
        const block = target.lineBlockAt(anchorPos);
        return Math.max(0, block.top + anchorOffsetTop);
      } catch {
        // Fall through to the stable pixel fallback.
      }
    }
    return nextScrollTop;
  };

  const applyFallbackScroll = (target: EditorView) => {
    target.scrollDOM.scrollTop = fallbackScrollTop(target);
    target.scrollDOM.scrollLeft = nextScrollLeft;
  };

  // Establish the approximate viewport before changing selection so CodeMirror
  // renders the relevant document region for the precise caret-based measure.
  applyFallbackScroll(view);
  view.dispatch({
    selection: { anchor: selectionAnchor, head: selectionHead },
    annotations: Transaction.addToHistory.of(false),
  });

  const requestAnchoredScroll = () => {
    if (!view.dom.isConnected) {
      return;
    }
    view.requestMeasure({
      key: RESTORE_VIEW_STATE_MEASURE_KEY,
      read: (target) => {
        let selectionScrollTop: number | null = null;
        if (selectionHeadViewportOffsetTop !== null) {
          try {
            const caret = target.coordsAtPos(selectionHead);
            const viewport = target.scrollDOM.getBoundingClientRect();
            if (caret) {
              selectionScrollTop = scrollTopForCaretViewportOffset(
                target.scrollDOM.scrollTop,
                caret.top - viewport.top,
                selectionHeadViewportOffsetTop,
              );
            }
          } catch {
            // Fall back to the document anchor until caret geometry is ready.
          }
        }
        return {
          scrollTop: selectionScrollTop ?? fallbackScrollTop(target),
          scrollLeft: nextScrollLeft,
        };
      },
      write: ({ scrollTop, scrollLeft }, target) => {
        target.scrollDOM.scrollTop = scrollTop;
        target.scrollDOM.scrollLeft = scrollLeft;
      },
    });
  };

  requestAnchoredScroll();

  // CodeMirror construction and rich Markdown widgets can settle over a couple
  // of frames. Reapply only during this bounded restore window; ongoing user
  // scrolling is never observed or overridden.
  requestAnimationFrame(() => {
    requestAnchoredScroll();
    requestAnimationFrame(() => {
      requestAnchoredScroll();
    });
  });
}
