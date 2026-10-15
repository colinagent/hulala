import assert from 'node:assert/strict';
import test from 'node:test';

import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';

import {
  findBlockWidgetRangeAt,
  livePreviewBlockDecorations,
} from './livePreviewBlockDecorations';

test('plain fenced code blocks do not create block widgets', () => {
  const doc = [
    '```shell',
    'bash: pwd',
    '$ pwd',
    '```',
    '',
    'after',
  ].join('\n');
  const toolBodyPos = doc.indexOf('bash: pwd');
  let state = EditorState.create({
    doc,
    extensions: [markdown(), ...livePreviewBlockDecorations()],
  });

  assert.equal(findBlockWidgetRangeAt(state, toolBodyPos), null);

  state = state.update({
    selection: { anchor: toolBodyPos },
  }).state;
  assert.equal(findBlockWidgetRangeAt(state, toolBodyPos), null);
});

test('non-mermaid fenced code blocks stay as ordinary code', () => {
  const doc = [
    '```notes',
    'plan',
    '```',
    '',
    'after',
  ].join('\n');
  const thinkingBodyPos = doc.indexOf('plan');
  const state = EditorState.create({
    doc,
    extensions: [markdown(), ...livePreviewBlockDecorations()],
  });

  assert.equal(findBlockWidgetRangeAt(state, thinkingBodyPos), null);
});

test('book highlight note blocks create block widgets until focused', () => {
  const doc = [
    '```note',
    'type: book-highlight',
    'source: ./Demo.epub',
    'title: Demo',
    'format: epub',
    'cfi: epubcfi(/6/2)',
    'created: 2026-06-02T08:00:00.000Z',
    '---',
    'Selected text',
    '```',
    '',
    'after',
  ].join('\n');
  const bodyPos = doc.indexOf('Selected text');
  const afterPos = doc.indexOf('after');
  let state = EditorState.create({
    doc,
    extensions: [markdown(), ...livePreviewBlockDecorations()],
    selection: { anchor: afterPos },
  });

  assert.deepEqual(findBlockWidgetRangeAt(state, bodyPos), {
    from: 0,
    to: doc.indexOf('\n\nafter') + 1,
  });

  state = state.update({
    selection: { anchor: bodyPos },
  }).state;
  assert.equal(findBlockWidgetRangeAt(state, bodyPos), null);
});

test('plain note blocks stay as ordinary code', () => {
  const doc = [
    '```note',
    'remember this',
    '```',
  ].join('\n');
  const bodyPos = doc.indexOf('remember');
  const state = EditorState.create({
    doc,
    extensions: [markdown(), ...livePreviewBlockDecorations()],
  });

  assert.equal(findBlockWidgetRangeAt(state, bodyPos), null);
});
