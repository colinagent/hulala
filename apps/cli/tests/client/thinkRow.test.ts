import { expect, test } from 'bun:test'
import type { TranscriptItem } from '../../src/tui/data/viewModel.js'
import { setActiveLanguage } from '../../src/tui/i18n/index.js'
import { buildTheme } from '../../src/tui/view/theme.js'
import { ThinkRow, reasoningText } from '../../src/tui/view/thinkRow.js'

const theme = buildTheme(false).markdown

function row(text: string, streaming = false): ThinkRow {
  const item: TranscriptItem = { kind: 'reasoning', text, streaming, time: 0 }
  if (item.kind !== 'reasoning') throw new Error('unreachable')
  return new ThinkRow(item, false, theme, () => mode, () => '  ')
}

let mode: 'tail' | 'full' | 'hidden' = 'tail'

test('reasoningText strips a provider signature block', () => {
  expect(reasoningText('plain thought')).toBe('plain thought')
  expect(reasoningText('<signature>abc</signature>\nreal thought')).toBe('real thought')
  expect(reasoningText('<signature>abc</signature>\r\nreal thought')).toBe('real thought')
})

test('reasoningText hides a partial or unclosed signature', () => {
  expect(reasoningText('<sign')).toBe('')
  expect(reasoningText('<signature>payload-without-end')).toBe('')
})

test('a short thought is shown whole, without a count', () => {
  mode = 'tail'
  const lines = row('Check the repo\nSecond line').render(80)
  expect(lines).toEqual(['  ✳  Think', '    Check the repo', '    Second line'])
})

test('a long thought keeps its last lines and counts the rest', () => {
  mode = 'tail'
  const text = Array.from({ length: 10 }, (_, index) => `thought line ${index + 1}`).join('\n')
  const lines = row(text).render(80)
  expect(lines[0]).toBe('  ✳  Think · … 5 more lines')
  expect(lines.slice(1)).toEqual([
    '    thought line 6',
    '    thought line 7',
    '    thought line 8',
    '    thought line 9',
    '    thought line 10',
  ])
})

test('the budget is visual lines, so one long line cannot flood the block', () => {
  mode = 'tail'
  const lines = row('word '.repeat(200).trim()).render(40)
  expect(lines).toHaveLength(6)
  expect(lines[0]).toContain('Think · … ')
  expect(lines.slice(1).every(line => line.length <= 40)).toBe(true)
})

test('a very long thought wraps a bounded window and still counts what is above', () => {
  mode = 'tail'
  const text = Array.from({ length: 200 }, (_, index) => `line ${index + 1} of a long thought`).join('\n')
  const lines = row(text).render(60)
  expect(lines).toHaveLength(6)
  const hidden = Number(/… (\d+) more lines/u.exec(lines[0]!)?.[1])
  expect(hidden).toBeGreaterThan(190)
})

test('emphasis markers come off the folded lines', () => {
  mode = 'tail'
  expect(row('a **bold** claim').render(80)[1]).toBe('    a bold claim')
})

test('the full mode renders the whole thought, and hidden renders nothing', () => {
  mode = 'full'
  const text = Array.from({ length: 8 }, (_, index) => `thought line ${index + 1}`).join('\n')
  const full = row(text).render(80)
  expect(full[0]).toBe('  ✳  Think')
  expect(full.join('\n')).toContain('thought line 1')
  expect(full.join('\n')).toContain('thought line 8')

  mode = 'hidden'
  expect(row(text).render(80)).toEqual([])
  mode = 'tail'
})

test('a thought that is only a signature draws nothing', () => {
  mode = 'tail'
  expect(row('<signature>b64payload</signature>').render(80)).toEqual([])
})

test('a streaming thought accents the glyph and a settled one does not', () => {
  mode = 'tail'
  const item: TranscriptItem = { kind: 'reasoning', text: 'thinking', streaming: true, time: 0 }
  if (item.kind !== 'reasoning') throw new Error('unreachable')
  const colored = new ThinkRow(item, true, theme, () => 'tail', () => '  ')
  expect(colored.render(80)[0]).toBe('  \u001b[36m✳ \u001b[0m Think')
})

test('a settled thought keeps the same rows, so the frame does not jump', () => {
  mode = 'tail'
  const item: TranscriptItem = { kind: 'reasoning', text: 'one\ntwo\nthree', streaming: true, time: 0 }
  if (item.kind !== 'reasoning') throw new Error('unreachable')
  const live = new ThinkRow(item, false, theme, () => 'tail', () => '  ').render(80)
  item.streaming = false
  const settled = new ThinkRow(item, false, theme, () => 'tail', () => '  ').render(80)
  expect(settled).toEqual(live)
})

test('the language reaches the count through the active locale', () => {
  mode = 'tail'
  setActiveLanguage('zh-CN')
  try {
    const text = Array.from({ length: 7 }, (_, index) => `thought ${index}`).join('\n')
    expect(row(text).render(80)[0]).toBe('  ✳  思考 · … 还有 2 行')
  } finally {
    setActiveLanguage('en')
  }
})
