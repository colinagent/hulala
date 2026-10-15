import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorState } from '@codemirror/state';

import { buildImageInsertion } from './imageInsertion.ts';

const IMAGE = '![capture](./assets/capture.png)';

test('image pasted into an empty document leaves an editable paragraph and lands in it', () => {
  const state = EditorState.create({ doc: '' });
  const result = buildImageInsertion(state, IMAGE);

  assert.deepEqual(result, {
    insert: `${IMAGE}\n\n`,
    cursorOffset: IMAGE.length + 2,
  });
});

test('image pasted at document end is isolated from preceding text and leaves an editable paragraph', () => {
  const doc = 'Before';
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
  });
  const result = buildImageInsertion(state, IMAGE);

  assert.deepEqual(result, {
    insert: `\n${IMAGE}\n\n`,
    cursorOffset: IMAGE.length + 3,
  });
});

test('image pasted before an existing line lands after the existing separator', () => {
  const doc = 'Before\nAfter';
  const state = EditorState.create({
    doc,
    selection: { anchor: 'Before'.length },
  });
  const result = buildImageInsertion(state, IMAGE);

  assert.deepEqual(result, {
    insert: `\n${IMAGE}`,
    cursorOffset: IMAGE.length + 2,
  });
});
