import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';

import { FRONTMATTER_SCAN_MAX_LINES, getFrontmatterInfo } from './frontmatter';

test('detects frontmatter within scan limit', () => {
  const content = ['---', 'id: agent-test', 'name: test', '---', '', 'body'].join('\n');
  const state = EditorState.create({ doc: content });
  const info = getFrontmatterInfo(state);

  assert.notEqual(info, null);
  assert.equal(info?.endLineNumber, 4);
});

test('detects frontmatter near scan limit', () => {
  const lines = ['---'];
  for (let i = 0; i < FRONTMATTER_SCAN_MAX_LINES - 3; i += 1) {
    lines.push(`key${i}: value${i}`);
  }
  lines.push('---', '', 'body');
  const state = EditorState.create({ doc: lines.join('\n') });
  const info = getFrontmatterInfo(state);

  assert.notEqual(info, null);
  assert.equal(info?.endLineNumber, lines.length - 2);
});

test('returns null when closing delimiter is beyond scan limit', () => {
  const lines = ['---'];
  for (let i = 0; i < FRONTMATTER_SCAN_MAX_LINES; i += 1) {
    lines.push(`key${i}: value${i}`);
  }
  lines.push('---', '', 'body');
  const state = EditorState.create({ doc: lines.join('\n') });
  const info = getFrontmatterInfo(state);

  assert.equal(info, null);
});
