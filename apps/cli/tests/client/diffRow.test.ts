import { expect, test } from 'bun:test'
import { diffRows, diffStats, fileDiffs, intendedDiff } from '../../src/tui/data/diffRow.js'

const meta = (diffs: unknown): unknown => ({ diffs })

test('fileDiffs narrows a well-formed result payload', () => {
  const diffs = fileDiffs(meta([{ path: 'src/a.ts', oldText: 'old', newText: 'new' }]))
  expect(diffs).toEqual([{ path: 'src/a.ts', oldText: 'old', newText: 'new' }])
  expect(fileDiffs(meta([{ path: 'a', oldText: null, newText: 'x' }]))).toHaveLength(1)
})

test('fileDiffs rejects absent, empty, and malformed payloads', () => {
  expect(fileDiffs(undefined)).toBeUndefined()
  expect(fileDiffs({})).toBeUndefined()
  expect(fileDiffs(meta([]))).toBeUndefined()
  expect(fileDiffs(meta([{ path: 1, oldText: 'a', newText: 'b' }]))).toBeUndefined()
  expect(fileDiffs(meta([{ path: 'a', oldText: 2, newText: 'b' }]))).toBeUndefined()
  expect(fileDiffs(meta([{ path: 'a', oldText: 'b' }]))).toBeUndefined()
  expect(fileDiffs({ stopped: true })).toBeUndefined()
})

test('intendedDiff previews an edit and never a write', () => {
  expect(intendedDiff('edit', { file_path: 'src/a.ts', old_string: 'one\ntwo', new_string: 'one\nthree' }))
    .toEqual({ path: 'src/a.ts', oldText: 'one\ntwo', newText: 'one\nthree' })
  // An empty search text means an insertion into an empty file.
  expect(intendedDiff('edit', { file_path: 'a', old_string: '', new_string: 'x' })?.oldText).toBeNull()
  expect(intendedDiff('write', { file_path: 'a', content: 'whole file' })).toBeUndefined()
  expect(intendedDiff('apply_patch', { patch: '*** Begin Patch' })).toBeUndefined()
  expect(intendedDiff('edit', { file_path: 'a', old_string: 'x' })).toBeUndefined()
})

test('a replacement becomes a path header, context, and a change pair', () => {
  const rows = diffRows([{
    path: 'src/a.ts',
    oldText: 'one\ntwo\nthree\nfour\nfive',
    newText: 'one\ntwo\nTHREE\nfour\nfive',
  }])
  expect(rows[0]).toEqual({ kind: 'path', text: 'src/a.ts' })
  expect(rows).toContainEqual({ kind: 'del', text: 'three' })
  expect(rows).toContainEqual({ kind: 'add', text: 'THREE' })
  expect(rows.filter(row => row.kind === 'context').map(row => row.text))
    .toEqual(['one', 'two', 'four', 'five'])
})

test('a created file is all additions and no removals', () => {
  const rows = diffRows([{ path: 'new.ts', oldText: null, newText: 'a\nb' }])
  expect(rows).toEqual([
    { kind: 'path', text: 'new.ts' },
    { kind: 'add', text: 'a' },
    { kind: 'add', text: 'b' },
  ])
  expect(diffStats(rows)).toEqual({ added: 2, removed: 0 })
})

test('two files each get a header, and two hunks of one file are separated', () => {
  const rows = diffRows([
    { path: 'a.ts', oldText: 'x', newText: 'y' },
    { path: 'a.ts', oldText: 'p', newText: 'q' },
    { path: 'b.ts', oldText: 'm', newText: 'n' },
  ])
  expect(rows.filter(row => row.kind === 'path').map(row => row.text)).toEqual(['a.ts', 'b.ts'])
  expect(rows.filter(row => row.kind === 'gap')).toHaveLength(1)
})

test('a scattered rewrite keeps one hunk per applied change', () => {
  const oldText = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n')
  const newText = oldText.replace('line 1\n', 'one\n').replace('line 18', 'eighteen')
  const rows = diffRows([{ path: 'a', oldText, newText }])
  expect(rows.filter(row => row.kind === 'del')).toHaveLength(2)
  expect(rows.filter(row => row.kind === 'add')).toHaveLength(2)
  // Only the context around each change survives: three lines after the first,
  // three before and one after the second.
  expect(rows.filter(row => row.kind === 'context')).toHaveLength(8)
})

test('a comparison past the edit limit degrades to a whole replacement', () => {
  const oldText = Array.from({ length: 300 }, (_, index) => `before ${index}`).join('\n')
  const newText = Array.from({ length: 300 }, (_, index) => `after ${index}`).join('\n')
  const rows = diffRows([{ path: 'a', oldText, newText }])
  expect(diffStats(rows)).toEqual({ added: 300, removed: 300 })
})

test('diffStats counts markers, not context', () => {
  expect(diffStats([
    { kind: 'path', text: 'a' },
    { kind: 'del', text: 'x' },
    { kind: 'add', text: 'y' },
    { kind: 'context', text: 'z' },
  ])).toEqual({ added: 1, removed: 1 })
})
