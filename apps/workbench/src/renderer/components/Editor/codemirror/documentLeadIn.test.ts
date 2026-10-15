import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';

import { resolveFirstEditableMarkdownPosition } from './documentLeadInPosition.ts';

test('first editable Markdown position is the first line for ordinary and empty documents', () => {
  assert.deepEqual(
    resolveFirstEditableMarkdownPosition(EditorState.create({ doc: 'Heading\nBody' }), null, false),
    { position: 0, insert: '' },
  );
  assert.deepEqual(
    resolveFirstEditableMarkdownPosition(EditorState.create({ doc: '' }), null, false),
    { position: 0, insert: '' },
  );
});

test('collapsed frontmatter skips hidden YAML and leading blank lines', () => {
  const content = '---\ntags:\n  - notes\n---\n\n\nFirst body line';
  assert.deepEqual(
    resolveFirstEditableMarkdownPosition(EditorState.create({ doc: content }), { endLineNumber: 4 }, true),
    { position: content.indexOf('First body line'), insert: '' },
  );
});

test('frontmatter-only documents reuse or materialize the first body line', () => {
  const withTrailingBodyLine = '---\ntags: notes\n---\n';
  assert.deepEqual(
    resolveFirstEditableMarkdownPosition(
      EditorState.create({ doc: withTrailingBodyLine }),
      { endLineNumber: 3 },
      true,
    ),
    { position: withTrailingBodyLine.length, insert: '' },
  );

  const withoutBodyLine = '---\ntags: notes\n---';
  assert.deepEqual(
    resolveFirstEditableMarkdownPosition(
      EditorState.create({ doc: withoutBodyLine }),
      { endLineNumber: 3 },
      true,
    ),
    { position: withoutBodyLine.length + 1, insert: '\n' },
  );
});
