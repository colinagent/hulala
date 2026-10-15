import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatToolCallSummary,
  normalizeToolCallName,
  tryFormatToolCallSummary,
} from './toolCallSummary';

test('normalizeToolCallName aligns tool aliases with projection semantics', () => {
  assert.equal(normalizeToolCallName('shell'), 'bash');
  assert.equal(normalizeToolCallName('read_file'), 'read');
  assert.equal(normalizeToolCallName('edit_file'), 'edit');
  assert.equal(normalizeToolCallName('Glob'), 'glob');
});

test('tryFormatToolCallSummary formats bash commands', () => {
  assert.equal(
    tryFormatToolCallSummary('shell', { command: 'rg -n "toolcall" src' }),
    'bash: rg -n "toolcall" src'
  );
});

test('tryFormatToolCallSummary formats path-based tools with basename only', () => {
  assert.equal(
    tryFormatToolCallSummary('read_file', { path: '/a/b/aa.md' }),
    'read: aa.md'
  );
  assert.equal(
    tryFormatToolCallSummary('edit_file', { path: 'C:\\repo\\src\\main.tsx' }),
    'edit: main.tsx'
  );
});

test('tryFormatToolCallSummary formats glob patterns', () => {
  assert.equal(
    tryFormatToolCallSummary('glob', { pattern: '**/*.ts' }),
    'glob: **/*.ts'
  );
});

test('formatToolCallSummary falls back to the normalized tool name when arguments are missing', () => {
  assert.equal(formatToolCallSummary('read_file', null), 'read');
  assert.equal(formatToolCallSummary('custom_tool', null), 'custom_tool');
});

test('formatToolCallSummary truncates long summaries', () => {
  const summary = formatToolCallSummary('bash', { command: `python -c "${'x '.repeat(80).trim()}"` });
  assert.ok(summary.startsWith('bash: python -c "x x x'));
  assert.ok(summary.endsWith('...'));
  assert.ok(Array.from(summary).length <= 120);
});
