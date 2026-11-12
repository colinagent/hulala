import { expect, test } from 'bun:test'
import { headPreview, tailPreview } from '../../src/tui/view/preview.js'

test('a body under the budget is kept whole and reports nothing hidden', () => {
  expect(tailPreview('one\ntwo\nthree', 40, 5)).toEqual({ lines: ['one', 'two', 'three'], hidden: 0 })
  expect(headPreview('one\ntwo\nthree', 40, 5)).toEqual({ lines: ['one', 'two', 'three'], hidden: 0 })
})

test('a long tail keeps the end and counts the rows above it', () => {
  const text = Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join('\n')
  expect(tailPreview(text, 40, 3)).toEqual({ lines: ['line 7', 'line 8', 'line 9'], hidden: 6 })
})

test('a long head keeps the start and counts the rows below it', () => {
  const text = Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join('\n')
  expect(headPreview(text, 40, 3)).toEqual({ lines: ['line 1', 'line 2', 'line 3'], hidden: 6 })
})

test('the budget counts wrapped rows, not source lines', () => {
  const text = 'word '.repeat(100).trim()
  const preview = tailPreview(text, 20, 2)
  expect(preview.lines).toHaveLength(2)
  expect(preview.lines.every(line => visibleWidthOf(line) <= 20)).toBe(true)
  expect(preview.hidden).toBeGreaterThan(0)
})

test('blank edges are trimmed so a folded row has no empty first line', () => {
  expect(tailPreview('\n\n  thought  \n', 40, 4)).toEqual({ lines: ['  thought'], hidden: 0 })
  expect(headPreview('\n\nfirst\nsecond', 40, 4).lines).toEqual(['first', 'second'])
})

test('a window that starts mid-line still counts the lines wholly above it', () => {
  const text = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join('\n')
  const preview = tailPreview(text, 60, 2)
  expect(preview.lines).toHaveLength(2)
  expect(preview.lines.at(-1)).toBe('line 200')
  expect(preview.hidden).toBeGreaterThan(190)
})

test('a window edge never splits a surrogate pair', () => {
  // The head window would end between this emoji's two halves…
  const head = `${'a'.repeat(1199)}😀${'b'.repeat(50)}`
  expect(headPreview(head, 4000, 3).lines.join('')).not.toContain('\ud83d')

  // …and the tail window would start between them.
  const tail = `${'a'.repeat(1198)}😀${'b'.repeat(1199)}`
  const preview = tailPreview(tail, 4000, 3)
  expect(preview.lines.join('')).not.toContain('\ude00')
  expect(preview.lines[0]?.startsWith('😀')).toBe(true)
})

function visibleWidthOf(line: string): number {
  // The preview hands back plain text here, so its length is its width.
  return line.length
}
