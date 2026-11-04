import { expect, test } from 'bun:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import { UserMessage } from '../../src/tui/view/userMessage.js'

const RESET = '\u001b[0m'

/** Drop ANSI styling so the visible glyphs can be asserted. */
const strip = (line: string): string => line.replace(/\u001b\[[0-9;]*m/gu, '')

test('draws the prompt as a padded panel row with the arrow inside it', () => {
  const lines = new UserMessage('who are you', true).render(40).map(strip)
  // Blank row above, the panel row, blank row below.
  expect(lines).toHaveLength(3)
  expect(lines[0]).toBe(' '.repeat(40))
  expect(lines[1]).toBe(' ❯ who are you' + ' '.repeat(40 - visibleWidth(' ❯ who are you')))
  expect(lines[2]).toBe(' '.repeat(40))
})

test('the panel background covers every wrapped line to the terminal edge', () => {
  const width = 24
  const lines = new UserMessage('a prompt that needs more than one panel row to fit', true).render(width)
  const panelRows = lines.filter(line => line.startsWith('\u001b['))
  expect(panelRows.length).toBeGreaterThan(1)
  for (const line of panelRows) {
    expect(line.endsWith(RESET)).toBe(true)
    // The panel is re-opened after the arrow's reset, so the row cannot fall
    // back to the terminal background mid-way.
    expect(line.split(RESET).length).toBeGreaterThan(1)
    expect(visibleWidth(strip(line))).toBe(width)
  }
})

test('continuation rows indent under the message text and carry no arrow', () => {
  const lines = new UserMessage('first line is long enough to wrap here', true).render(20).map(strip)
  const panelRows = lines.filter(line => line.trim() !== '')
  expect(panelRows[0]?.startsWith(' ❯ ')).toBe(true)
  expect(panelRows.slice(1).every(line => line.startsWith('   '))).toBe(true)
  expect(panelRows.slice(1).some(line => line.includes('❯'))).toBe(false)
})

test('multi-line prompts keep one panel row per source line', () => {
  const lines = new UserMessage('one\ntwo\nthree', true).render(30).map(strip)
  expect(lines.filter(line => line.trim() !== '')).toEqual([
    ' ❯ one' + ' '.repeat(24),
    '   two' + ' '.repeat(24),
    '   three' + ' '.repeat(22),
  ])
})

test('without colour the panel degrades to plain text', () => {
  const lines = new UserMessage('hello', false).render(40)
  expect(lines.every(line => !line.includes('\u001b'))).toBe(true)
  expect(lines[1]?.startsWith(' ❯ hello')).toBe(true)
})

test('narrow terminals still render one panel row per line', () => {
  const lines = new UserMessage('hello', true).render(6).map(strip)
  expect(lines.every(line => visibleWidth(line) === 6)).toBe(true)
})
