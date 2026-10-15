import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseFrontmatterDocument,
  patchFrontmatterDocument,
  splitFrontmatter,
} from './frontmatterYaml';

test('splitFrontmatter extracts body offset', () => {
  const content = ['---', 'thread: thread-123', 'title: Hello', '---', '', 'body'].join('\n');
  const split = splitFrontmatter(content);
  assert.ok(split);
  assert.equal(split.rawBody, 'thread: thread-123\ntitle: Hello');
  assert.equal(split.body.trim(), 'body');
});

test('parseFrontmatterDocument parses agent yaml arrays', () => {
  const content = ['---', 'id: agent-notes', 'tags: [builtin, knowledge, notes]', 'opcodes: [read]', 'tools: [search]', '---', 'Synthetic fixture'].join('\n');
  const parsed = parseFrontmatterDocument(content);
  assert.ok(parsed);
  assert.equal(parsed.data.id, 'agent-notes');
  assert.deepEqual(parsed.data.tags, ['builtin', 'knowledge', 'notes']);
  assert.ok(Array.isArray(parsed.data.opcodes));
  assert.ok(Array.isArray(parsed.data.tools));
});

test('parseFrontmatterDocument handles scalar tags', () => {
  const content = ['---', 'id: agent-coder', 'tags: builtin', '---', '', 'body'].join('\n');
  const parsed = parseFrontmatterDocument(content);
  assert.ok(parsed);
  assert.equal(parsed.data.tags, 'builtin');
});

test('parseFrontmatterDocument accepts unquoted agent refs and list refs', () => {
  const content = [
    '---',
    'bind: @agent-coder',
    'skills:',
    '  - @skills/search',
    '---',
    '',
    'body',
  ].join('\n');
  const parsed = parseFrontmatterDocument(content);
  assert.ok(parsed);
  assert.equal(parsed.data.bind, '@agent-coder');
  assert.deepEqual(parsed.data.skills, ['@skills/search']);
});

test('patchFrontmatterDocument updates scalar and preserves body', () => {
  const content = ['---', 'name: old', 'tags:', '  - a', '---', '', 'Keep me'].join('\n');
  const next = patchFrontmatterDocument(content, { type: 'set', key: 'name', value: 'new' });
  const parsed = parseFrontmatterDocument(next);
  assert.ok(parsed);
  assert.equal(parsed.data.name, 'new');
  assert.deepEqual(parsed.data.tags, ['a']);
  assert.equal(parsed.body.trim(), 'Keep me');
});

test('patchFrontmatterDocument can delete keys and add list values', () => {
  const content = ['---', 'tags:', '  - a', 'note: x', '---', ''].join('\n');
  const tagged = patchFrontmatterDocument(content, { type: 'set', key: 'tags', value: ['a', 'b'] });
  const parsed = parseFrontmatterDocument(tagged);
  assert.deepEqual(parsed?.data.tags, ['a', 'b']);

  const deleted = patchFrontmatterDocument(tagged, { type: 'delete', key: 'note' });
  const afterDelete = parseFrontmatterDocument(deleted);
  assert.equal(afterDelete?.data.note, undefined);
});

test('patchFrontmatterDocument writes run objects as block yaml', () => {
  const content = ['---', 'name: coder', '---', '', 'body'].join('\n');
  const next = patchFrontmatterDocument(content, {
    type: 'set',
    key: 'run',
    value: {
      command: ['bin/coder', '--port', '8080'],
      daemon: true,
    },
  });

  assert.match(
    next,
    /run:\n  command:\n    - "bin\/coder"\n    - "--port"\n    - "8080"\n  daemon: true/,
  );
  assert.deepEqual(parseFrontmatterDocument(next)?.data.run, {
    command: ['bin/coder', '--port', '8080'],
    daemon: true,
  });
});

test('round-trip keeps canonical chat frontmatter keys', () => {
  const content = ['---', 'thread: thread-abc', 'title: "Hello"', '---', '', 'body'].join('\n');
  const parsed = parseFrontmatterDocument(content);
  assert.ok(parsed);
  assert.equal(parsed.data.thread, 'thread-abc');
  assert.equal(parsed.data.title, 'Hello');

  const next = patchFrontmatterDocument(content, { type: 'set', key: 'title', value: 'Updated' });
  const reparsed = parseFrontmatterDocument(next);
  assert.equal(reparsed?.data.title, 'Updated');
  assert.equal(reparsed?.data.thread, 'thread-abc');
});

test('splitFrontmatter and patch preserve CRLF line endings', () => {
  const content = '---\r\nname: old\r\n---\r\n\r\nbody';
  const split = splitFrontmatter(content);
  assert.ok(split);
  assert.equal(split.lineBreak, '\r\n');
  assert.equal(split.rawBody, 'name: old');

  const next = patchFrontmatterDocument(content, { type: 'set', key: 'name', value: 'new' });
  assert.match(next, /\r\n/);
  assert.equal(parseFrontmatterDocument(next)?.data.name, 'new');
  assert.match(next, /body$/);
});

test('invalid yaml frontmatter returns null', () => {
  const content = ['---', 'foo: "unclosed', '---', '', 'body'].join('\n');
  assert.equal(parseFrontmatterDocument(content), null);
});
