import assert from 'node:assert/strict';
import test from 'node:test';

import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

import {
  getVisibleDocBounds,
  resolveLivePreviewReplacePolicy,
} from './livePreviewParsePolicy';

function buildLongMarkdownDoc(sectionCount: number): string {
  const lines: string[] = ['# Long document'];
  for (let i = 0; i < sectionCount; i += 1) {
    lines.push('');
    lines.push(`## Section ${i}`);
    lines.push('');
    lines.push(`> blockquote **emphasis ${i}**`);
    lines.push('');
    lines.push('```');
    lines.push(`code line ${i}`);
    lines.push('```');
    lines.push('');
    lines.push(`Plain paragraph ${i} with *inline* formatting.`);
  }
  return lines.join('\n');
}

test('long markdown is not fully parsed on initial state creation', () => {
  const doc = buildLongMarkdownDoc(120);
  const state = EditorState.create({
    doc,
    extensions: [markdown()],
  });
  const midPos = doc.indexOf('## Section 60');

  assert.ok(midPos > 0);
  assert.equal(syntaxTreeAvailable(state, midPos), false);
});

test('resolveLivePreviewReplacePolicy blocks replace decorations until visible range is parsed', () => {
  const doc = buildLongMarkdownDoc(120);
  const state = EditorState.create({
    doc,
    extensions: [markdown()],
  });
  const midPos = doc.indexOf('## Section 60');

  assert.equal(syntaxTreeAvailable(state, midPos), false);
  assert.equal(resolveLivePreviewReplacePolicy(state, midPos), false);
});

test('resolveLivePreviewReplacePolicy allows replace decorations after parsing reaches visible range', () => {
  const doc = buildLongMarkdownDoc(120);
  const state = EditorState.create({
    doc,
    extensions: [markdown()],
  });
  const midPos = doc.indexOf('## Section 60');

  ensureSyntaxTree(state, midPos, 1000);

  assert.equal(syntaxTreeAvailable(state, midPos), true);
  assert.equal(resolveLivePreviewReplacePolicy(state, midPos), true);
});

test('resolveLivePreviewReplacePolicy allows replace decorations near document start', () => {
  const doc = buildLongMarkdownDoc(120);
  const state = EditorState.create({
    doc,
    extensions: [markdown()],
  });
  const introPos = doc.indexOf('## Section 0') + '## Section 0'.length;

  assert.equal(resolveLivePreviewReplacePolicy(state, introPos), true);
});

test('getVisibleDocBounds merges editor visible ranges', () => {
  assert.deepEqual(
    getVisibleDocBounds([{ from: 120, to: 480 }, { from: 40, to: 200 }], 1000),
    { from: 40, to: 480 }
  );
  assert.deepEqual(getVisibleDocBounds([], 1000), { from: 0, to: 0 });
});
