import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pickTrustedCodeMirrorViewState,
  scrollTopForCaretViewportOffset,
  visibleCaretViewportOffsetTop,
  type CodeMirrorViewStateSnapshot,
} from './viewState.ts';

const scrolled: CodeMirrorViewStateSnapshot = {
  selectionAnchor: 820,
  selectionHead: 840,
  scrollTop: 1200,
  scrollLeft: 0,
  scrollAnchorPos: 760,
  scrollAnchorOffsetTop: 18,
};

const detachedTop: CodeMirrorViewStateSnapshot = {
  selectionAnchor: 820,
  selectionHead: 840,
  scrollTop: 0,
  scrollLeft: 0,
  scrollAnchorPos: 0,
  scrollAnchorOffsetTop: 0,
};

test('trusted geometry keeps the live capture', () => {
  assert.deepEqual(
    pickTrustedCodeMirrorViewState(detachedTop, scrolled, true),
    detachedTop,
  );
});

test('detached scroller keeps the last trusted scroll anchor', () => {
  assert.deepEqual(
    pickTrustedCodeMirrorViewState(detachedTop, scrolled, false),
    scrolled,
  );
});

test('detached scroller without a prior snapshot falls back to live capture', () => {
  assert.deepEqual(
    pickTrustedCodeMirrorViewState(detachedTop, null, false),
    detachedTop,
  );
});

test('visible caret captures its viewport-relative vertical position', () => {
  assert.equal(
    visibleCaretViewportOffsetTop(
      { top: 410, bottom: 432 },
      { top: 100, bottom: 700 },
    ),
    310,
  );
  assert.equal(
    visibleCaretViewportOffsetTop(
      { top: 710, bottom: 732 },
      { top: 100, bottom: 700 },
    ),
    null,
  );
});

test('caret viewport anchor wins over a drifting document-top anchor', () => {
  assert.equal(scrollTopForCaretViewportOffset(300, 510, 110), 700);
  assert.equal(scrollTopForCaretViewportOffset(20, 10, 80), 0);
  assert.equal(scrollTopForCaretViewportOffset(Number.NaN, 10, 10), null);
});
