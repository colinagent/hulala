import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activateComposerPlanBlock,
  areComposerPlanStatesEqual,
  mapComposerPlanState,
  removeComposerPlanBlock,
  type ComposerPlanState,
} from './chatPlanBlock';

test('activateComposerPlanBlock appends a plan block at the document end', () => {
  const result = activateComposerPlanBlock({
    content: 'hello',
    cursor: 5,
    currentPlan: null,
  });

  assert.equal(result.content, 'hello\n\n');
  assert.equal(result.selection, 7);
  assert.deepEqual(result.planState, {
    anchor: 6,
    beforeSpacer: { from: 5, to: 6, text: '\n' },
    afterSpacer: { from: 6, to: 7, text: '\n' },
  });
});

test('activateComposerPlanBlock keeps one empty line below the plan when inserting mid-line', () => {
  const result = activateComposerPlanBlock({
    content: 'abcdef',
    cursor: 3,
    currentPlan: null,
  });

  assert.equal(result.content, 'abc\n\n\ndef');
  assert.equal(result.selection, 5);
  assert.equal(result.planState.anchor, 4);
  assert.deepEqual(result.planState.beforeSpacer, { from: 3, to: 4, text: '\n' });
  assert.deepEqual(result.planState.afterSpacer, { from: 4, to: 6, text: '\n\n' });
});

test('activateComposerPlanBlock reuses an existing blank line without adding a second spacer above', () => {
  const result = activateComposerPlanBlock({
    content: 'abc\n',
    cursor: 4,
    currentPlan: null,
  });

  assert.equal(result.content, 'abc\n\n');
  assert.equal(result.selection, 5);
  assert.equal(result.planState.anchor, 4);
  assert.equal(result.planState.beforeSpacer, null);
  assert.deepEqual(result.planState.afterSpacer, { from: 4, to: 5, text: '\n' });
});

test('activateComposerPlanBlock ignores the selected text and uses the selection head as the anchor', () => {
  const result = activateComposerPlanBlock({
    content: 'abcdef',
    cursor: 2,
    currentPlan: null,
  });

  assert.equal(result.planState.anchor, 3);
  assert.equal(result.content, 'ab\n\n\ncdef');
  assert.equal(result.selection, 4);
});

test('activateComposerPlanBlock repositions an existing plan block instead of duplicating it', () => {
  const first = activateComposerPlanBlock({
    content: 'alpha beta',
    cursor: 5,
    currentPlan: null,
  });
  const second = activateComposerPlanBlock({
    content: first.content,
    cursor: first.content.length,
    currentPlan: first.planState,
  });

  assert.equal(second.content, 'alpha beta\n\n');
  assert.equal(second.selection, 12);
  assert.deepEqual(second.planState, {
    anchor: 11,
    beforeSpacer: { from: 10, to: 11, text: '\n' },
    afterSpacer: { from: 11, to: 12, text: '\n' },
  });
});

test('removeComposerPlanBlock removes untouched plan spacers', () => {
  const activated = activateComposerPlanBlock({
    content: 'hello',
    cursor: 5,
    currentPlan: null,
  });
  const removed = removeComposerPlanBlock({
    content: activated.content,
    cursor: activated.selection,
    planState: activated.planState,
  });

  assert.equal(removed.content, 'hello');
  assert.equal(removed.selection, 5);
  assert.equal(removed.removedBeforeSpacer, true);
  assert.equal(removed.removedAfterSpacer, true);
});

test('removeComposerPlanBlock keeps modified user content when the blank line below the plan was edited', () => {
  const activated = activateComposerPlanBlock({
    content: 'abcdef',
    cursor: 3,
    currentPlan: null,
  });
  const modifiedContent = 'abc\n\nnotes\n\ndef';
  const modifiedPlanState: ComposerPlanState = mapComposerPlanState(activated.planState, {
    mapPos(pos, assoc = -1) {
      if (pos < 5) {
        return pos;
      }
      if (pos === 5) {
        return assoc < 0 ? 5 : 11;
      }
      return pos + 6;
    },
  });
  const removed = removeComposerPlanBlock({
    content: modifiedContent,
    cursor: 11,
    planState: modifiedPlanState,
  });

  assert.equal(removed.content, modifiedContent);
  assert.equal(removed.selection, 11);
  assert.equal(removed.removedBeforeSpacer, false);
  assert.equal(removed.removedAfterSpacer, false);
});

test('mapComposerPlanState remaps the anchor and both spacer ranges', () => {
  const state: ComposerPlanState = {
    anchor: 6,
    beforeSpacer: { from: 5, to: 6, text: '\n' },
    afterSpacer: { from: 6, to: 7, text: '\n' },
  };
  const mapped = mapComposerPlanState(state, {
    mapPos(pos) {
      return pos >= 3 ? pos + 2 : pos;
    },
  });

  assert.deepEqual(mapped, {
    anchor: 8,
    beforeSpacer: { from: 7, to: 8, text: '\n' },
    afterSpacer: { from: 8, to: 9, text: '\n' },
  });
});

test('areComposerPlanStatesEqual compares nulls and spacer ranges structurally', () => {
  const state: ComposerPlanState = {
    anchor: 1,
    beforeSpacer: null,
    afterSpacer: { from: 1, to: 2, text: '\n' },
  };

  assert.equal(areComposerPlanStatesEqual(null, null), true);
  assert.equal(areComposerPlanStatesEqual(state, state), true);
  assert.equal(areComposerPlanStatesEqual(state, { ...state }), true);
  assert.equal(
    areComposerPlanStatesEqual(state, {
      ...state,
      afterSpacer: { from: 1, to: 3, text: '\n\n' },
    }),
    false,
  );
});
