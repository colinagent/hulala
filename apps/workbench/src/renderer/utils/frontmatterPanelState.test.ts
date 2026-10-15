import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';

import {
  frontmatterPanelOptionsFacet,
  frontmatterSourceModeField,
  isFrontmatterSourceMode,
  shouldCollapseFrontmatterYaml,
  shouldShowFrontmatterProperties,
  toggleFrontmatterSourceModeEffect,
} from './frontmatterPanelState';

function createState(doc: string, selectionAnchor: number): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: selectionAnchor },
    extensions: [
      frontmatterSourceModeField,
      frontmatterPanelOptionsFacet.of({ readOnly: false, exportMode: false }),
    ],
  });
}

test('frontmatter stays in properties mode when cursor is inside yaml', () => {
  const doc = [
    '---',
    'title: Demo',
    'tags:',
    '  - note',
    '---',
    '# Body',
    '',
  ].join('\n');
  const state = createState(doc, doc.indexOf('title'));

  assert.equal(isFrontmatterSourceMode(state), false);
  assert.equal(shouldShowFrontmatterProperties(state), true);
  assert.equal(shouldCollapseFrontmatterYaml(state), true);
});

test('frontmatter source mode requires explicit toggle', () => {
  const doc = [
    '---',
    'title: Demo',
    '---',
    '# Body',
    '',
  ].join('\n');
  const initial = createState(doc, doc.indexOf('# Body'));
  const toggled = initial.update({
    effects: toggleFrontmatterSourceModeEffect.of(true),
  }).state;

  assert.equal(isFrontmatterSourceMode(initial), false);
  assert.equal(isFrontmatterSourceMode(toggled), true);
  assert.equal(shouldShowFrontmatterProperties(toggled), false);
  assert.equal(shouldCollapseFrontmatterYaml(toggled), false);
});

test('conversation markdown also uses the properties panel', () => {
  const doc = [
    '---',
    'thread: thread-123',
    'title: who am I',
    '---',
    '',
    '# who am I',
    '',
  ].join('\n');
  const state = createState(doc, doc.indexOf('# who'));

  assert.equal(shouldShowFrontmatterProperties(state), true);
  assert.equal(shouldCollapseFrontmatterYaml(state), true);
});
