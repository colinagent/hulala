import { expect, test } from 'bun:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { PendingState } from '../../src/tui/data/viewModel.js'
import { PendingMessages } from '../../src/tui/view/pendingMessages.js'

/** Strip SGR so assertions read the painted text. */
const strip = (line: string): string => line.replace(/\u001b\[[0-9;]*m/gu, '')

function rows(state: PendingState, width = 80): string[] {
  const view = new PendingMessages(false)
  view.setState(state)
  return view.render(width).map(strip)
}

test('an empty inbox renders no rows at all', () => {
  expect(rows({ steering: [], followUp: [] })).toEqual([])
})

test('steering comes first, then follow-ups, then the dequeue hint', () => {
  expect(rows({
    steering: [{ id: 's1', text: 'use the smaller diff' }],
    followUp: [{ id: 'q1', text: 'then run the tests' }],
  })).toEqual([
    '',
    '  Steering: use the smaller diff',
    '  Follow-up: then run the tests',
    '  ↳ alt+up to edit all queued messages',
  ])
})

test('one occurrence stays on one line, whitespace collapsed and truncated to the width', () => {
  const [blank, first] = rows({
    steering: [],
    followUp: [{ id: 'q1', text: 'line one\n\nline two\tand a tail that runs past the terminal edge' }],
  }, 40)
  expect(blank).toBe('')
  expect(first).toBe('  Follow-up: line one line two and a ...')
  expect(first).not.toContain('\n')
  expect(visibleWidth(first ?? '')).toBeLessThanOrEqual(40)
})

test('an occurrence the terminal cannot render says so instead of vanishing', () => {
  const [, row] = rows({ steering: [{ id: 'image-1' }], followUp: [] })
  expect(row).toBe('  Steering: (attachments)')
})
