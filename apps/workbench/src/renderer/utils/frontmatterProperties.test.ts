import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferPropertyKind,
  normalizeObjectEntries,
  normalizeListValue,
  normalizeTagsValue,
  patchObjectEntry,
  summarizeComplexValue,
  formatRunCommand,
  parseRunCommand,
  inferRunEndpointMode,
  switchRunEndpointMode,
} from './frontmatterProperties';

test('inferPropertyKind maps known frontmatter keys', () => {
  assert.equal(inferPropertyKind('thread', 'thread-1'), 'link-thread');
  assert.equal(inferPropertyKind('parent_thread', 'thread-2'), 'link-thread');
  assert.equal(inferPropertyKind('bind', '@agent-coder'), 'text');
  assert.equal(inferPropertyKind('tags', ['a']), 'tags');
  assert.equal(inferPropertyKind('tools', ['shell']), 'list');
  assert.equal(inferPropertyKind('run', { command: ['bin'] }), 'run');
  assert.equal(inferPropertyKind('schedule', [{ every: '1h' }]), 'object-list');
});

test('normalizeTagsValue accepts scalar and array forms', () => {
  assert.deepEqual(normalizeTagsValue('builtin'), ['builtin']);
  assert.deepEqual(normalizeTagsValue(['knowledge', 'notes']), ['knowledge', 'notes']);
  assert.deepEqual(normalizeTagsValue('builtin,server,system'), ['builtin', 'server', 'system']);
  assert.deepEqual(normalizeTagsValue('"builtin,server,system"'), ['builtin', 'server', 'system']);
  assert.deepEqual(normalizeTagsValue(['builtin', 'server,system']), ['builtin', 'server', 'system']);
});

test('normalizeListValue stringifies list entries', () => {
  assert.deepEqual(normalizeListValue(['thread/submit', 'prompt/get']), ['thread/submit', 'prompt/get']);
});

test('normalizeObjectEntries preserves yaml object order', () => {
  assert.deepEqual(
    normalizeObjectEntries({ command: ['bin/coder'], daemon: true }),
    [
      { key: 'command', value: ['bin/coder'] },
      { key: 'daemon', value: true },
    ],
  );
});

test('patchObjectEntry can set and delete nested keys', () => {
  assert.deepEqual(
    patchObjectEntry({ command: ['bin/coder'] }, 'daemon', true),
    { command: ['bin/coder'], daemon: true },
  );
  assert.deepEqual(
    patchObjectEntry({ command: ['bin/coder'], daemon: true }, 'daemon', undefined),
    { command: ['bin/coder'] },
  );
});

test('summarizeComplexValue truncates long payloads', () => {
  const summary = summarizeComplexValue({ command: ['a'.repeat(120)] });
  assert.match(summary, /\.\.\.$/);
  assert.ok(summary.length <= 96);
});

test('formatRunCommand and parseRunCommand round-trip argv arrays', () => {
  const simple = ['bin/coder'];
  assert.equal(formatRunCommand(simple), 'bin/coder');
  assert.deepEqual(parseRunCommand('bin/coder'), simple);

  const server = ['./bin/hulala-server', '--host', '127.0.0.1', '--port', '19530'];
  const formatted = formatRunCommand(server);
  assert.equal(formatted, './bin/hulala-server --host 127.0.0.1 --port 19530');
  assert.deepEqual(parseRunCommand(formatted), server);
});

test('formatRunCommand quotes tokens with whitespace', () => {
  const argv = ['bin/tool', 'arg with spaces', '--flag'];
  const formatted = formatRunCommand(argv);
  assert.equal(formatted, 'bin/tool "arg with spaces" --flag');
  assert.deepEqual(parseRunCommand(formatted), argv);
});

test('parseRunCommand accepts single and double quoted tokens', () => {
  assert.deepEqual(parseRunCommand(`bin/tool 'single quoted' "double quoted"`), [
    'bin/tool',
    'single quoted',
    'double quoted',
  ]);
  assert.deepEqual(parseRunCommand(''), []);
  assert.deepEqual(parseRunCommand('   '), []);
});

test('switchRunEndpointMode keeps url mode when only daemon remains', () => {
  assert.deepEqual(
    switchRunEndpointMode({ command: ['bin/coder'], daemon: true }, 'url'),
    { url: '', daemon: true },
  );
  assert.equal(inferRunEndpointMode({ url: '', daemon: true }), 'url');
  assert.equal(inferRunEndpointMode({ command: ['bin/coder'], daemon: true }), 'command');
});

test('switchRunEndpointMode clears the opposite endpoint fields', () => {
  assert.deepEqual(
    switchRunEndpointMode({ url: 'http://127.0.0.1:8080/mcp', daemon: true }, 'command'),
    { daemon: true },
  );
});
