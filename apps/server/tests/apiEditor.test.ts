/**
 * The editor channel's request fence.
 *
 * The Host starts a real Neovim for whoever asks, so the request is validated
 * before any process exists: an absolute existing directory, a grid inside the
 * terminal column's limits, and a theme object. These tests pin the refusals.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEditorOpen } from '../src/plugins/apiEditor.ts'

const cwd = mkdtempSync(join(tmpdir(), 'hulala-editor-api-'))
const theme = { background: '#000000', foreground: '#ffffff', palette: ['#000000'] }

test('an absolute existing directory opens', () => {
  expect(parseEditorOpen({ kind: 'open', cwd, cols: 100, rows: 30, theme })).toEqual({
    kind: 'open',
    cwd,
    cols: 100,
    rows: 30,
    theme: theme as never,
  })
})

test('a relative path is refused, because the Host has no client directory', () => {
  expect(parseEditorOpen({ kind: 'open', cwd: 'workspace', cols: 100, rows: 30, theme })).toBeUndefined()
})

test('a missing directory is refused before any process starts', () => {
  expect(parseEditorOpen({ kind: 'open', cwd: join(cwd, 'gone'), cols: 100, rows: 30, theme })).toBeUndefined()
})

test('a grid outside the column limits is refused', () => {
  expect(parseEditorOpen({ kind: 'open', cwd, cols: 0, rows: 30, theme })).toBeUndefined()
  expect(parseEditorOpen({ kind: 'open', cwd, cols: 501, rows: 30, theme })).toBeUndefined()
  expect(parseEditorOpen({ kind: 'open', cwd, cols: 100, rows: 201, theme })).toBeUndefined()
  expect(parseEditorOpen({ kind: 'open', cwd, cols: 100.5, rows: 30, theme })).toBeUndefined()
})

test('a frame that is not an open request is refused', () => {
  expect(parseEditorOpen({ kind: 'resize' })).toBeUndefined()
  expect(parseEditorOpen(undefined)).toBeUndefined()
  expect(parseEditorOpen({ kind: 'open', cwd, cols: 100, rows: 30 })).toBeUndefined()
})
