import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorState } from '@codemirror/state';

import { blockStructureIndexField } from './utils/blockStructureIndex';
import {
  findTableRangeAtPos,
  openTableSourceEffect,
  tableSourceBlockField,
} from './tableSourceState';

test('table source state follows the indexed table range', () => {
  const doc = [
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    'after',
  ].join('\n');
  let state = EditorState.create({
    doc,
    extensions: [blockStructureIndexField, tableSourceBlockField],
  });

  const tableRange = findTableRangeAtPos(state, doc.indexOf('| 1 | 2 |'));
  assert.deepEqual(tableRange, {
    from: 0,
    to: state.doc.line(3).to,
  });

  state = state.update({
    effects: openTableSourceEffect.of(tableRange!.from),
    selection: { anchor: doc.indexOf('| 1 | 2 |') },
  }).state;
  assert.equal(state.field(tableSourceBlockField), tableRange!.from);

  state = state.update({
    selection: { anchor: doc.indexOf('after') },
  }).state;
  assert.equal(state.field(tableSourceBlockField), null);
});
