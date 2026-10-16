import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorState } from '@codemirror/state';

import {
  imageSourceField,
  openImageSourceEffect,
} from './imageSourceState';

test('keeps image source open while caret stays on the same source line', () => {
  const state = EditorState.create({
    doc: [
      '![demo](./assets/demo.png){width=10%}',
      'next line',
    ].join('\n'),
    extensions: [imageSourceField],
  });

  const opened = state.update({
    effects: openImageSourceEffect.of({ from: 0, to: state.doc.line(1).to }),
    selection: { anchor: 0 },
  }).state;

  assert.deepEqual(opened.field(imageSourceField), {
    from: 0,
    to: state.doc.line(1).to,
  });

  const movedOnSameLine = opened.update({
    selection: { anchor: opened.doc.line(1).to },
  }).state;

  assert.deepEqual(movedOnSameLine.field(imageSourceField), {
    from: 0,
    to: state.doc.line(1).to,
  });

  const movedToNextLine = movedOnSameLine.update({
    selection: { anchor: movedOnSameLine.doc.line(2).from },
  }).state;

  assert.equal(movedToNextLine.field(imageSourceField), null);
});
