/**
 * What a frame costs while the viewport only scrolled.
 *
 * A terminal frame re-renders the whole tree, so a long conversation used to pay
 * for every row it had ever drawn on every wheel notch: user prompts re-wrapped,
 * tool rows re-derived, the document re-concatenated. The contract these tests
 * pin down is the fix — a row answers with the same array while nothing about it
 * changed, and the transcript hands back the document it already had.
 */
import { afterEach, expect, test } from 'bun:test'
import type { TuiMouseEvent } from '@earendil-works/pi-tui'
import type { TranscriptItem } from '../../src/tui/data/viewModel.js'
import { ThinkRow } from '../../src/tui/view/thinkRow.js'
import { ToolRowView } from '../../src/tui/view/toolRow.js'
import { Transcript } from '../../src/tui/view/transcript.js'
import { UserMessage } from '../../src/tui/view/userMessage.js'
import { buildTheme } from '../../src/tui/view/theme.js'
import { setActiveLanguage } from '../../src/tui/i18n/index.js'

afterEach(() => setActiveLanguage('en'))

function history(turns: number): TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (let turn = 0; turn < turns; turn += 1) {
    items.push({ kind: 'user', text: `question ${turn}`, time: turn })
    items.push({ kind: 'reasoning', text: `thought ${turn}`, streaming: false, time: turn })
    items.push({ kind: 'assistant', text: `answer ${turn}`, streaming: false, time: turn })
    items.push({
      kind: 'tool',
      name: 'read',
      args: JSON.stringify({ file_path: '/work/README.md' }),
      result: 'body',
      status: 'ok',
      time: turn,
      durationMs: 10,
    })
  }
  return items
}

test('a frame that only scrolled reuses the document it already had', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work' }))
  transcript.setItems(history(50))
  const first = transcript.render(60)
  expect(transcript.render(60)).toBe(first)
  expect(transcript.render(60)).toBe(first)
})

test('a width change, a disclosure toggle and a delta each rebuild the document', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work' }))
  const items = history(2)
  transcript.setItems(items)
  const first = transcript.render(60)

  const narrowed = transcript.render(50)
  expect(narrowed).not.toBe(first)

  transcript.toggleExpandAll()
  const expanded = transcript.render(60)
  expect(expanded).not.toBe(first)
  expect(expanded.length).toBeGreaterThan(first.length)

  // A settled item keeps its row; a streamed delta has to reach the frame.
  const assistant = items[2]!
  if (assistant.kind === 'assistant') assistant.text = 'answer 0, longer'
  expect(transcript.render(60).join('\n')).toContain('answer 0, longer')
})

test('the pointer and a fold still move the frame', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work' }))
  transcript.setItems([
    {
      kind: 'tool',
      name: 'bash',
      args: JSON.stringify({ command: 'ls -la', description: 'List files' }),
      result: '[exit code: 0]',
      status: 'ok',
      time: 0,
      durationMs: 120,
    },
  ])
  const at = (type: TuiMouseEvent['type'], button: TuiMouseEvent['button'] = 'none'): TuiMouseEvent => ({
    type, button, x: 3, y: 0, screenX: 3, screenY: 0, width: 60, height: 10, shift: false, alt: false, ctrl: false,
  })
  expect(transcript.render(60)[0]).toBe('  >_ Bash · List files')

  // Hover reveals the disclosure glyph on the row under the pointer…
  expect(transcript.handleMouse(at('move'))).toEqual({ handled: true, render: true })
  expect(transcript.render(60)[0]).toContain('▸ >_ Bash')

  // …and a click unfolds that one row, so the cached frame has to follow. The
  // press itself stays free for the alternate screen's drag selection.
  expect(transcript.handleMouse(at('press', 'left'))).toBeUndefined()
  expect(transcript.handleMouse(at('click', 'left'))).toEqual({ handled: true, render: true })
  expect(transcript.render(60)[0]).toContain('▾ >_ Bash')
})

test('a user prompt keeps its wrapped panel until the width changes', () => {
  const message = new UserMessage('a prompt that needs more than one row', true)
  const first = message.render(40)
  expect(message.render(40)).toBe(first)
  expect(message.render(30)).not.toBe(first)
})

test('a tool row redraws only when the row it draws changes', () => {
  const item: TranscriptItem = {
    kind: 'tool',
    name: 'read',
    args: JSON.stringify({ file_path: '/work/README.md' }),
    result: 'body',
    status: 'ok',
    time: 0,
    durationMs: 10,
  }
  if (item.kind !== 'tool') throw new Error('unreachable')
  const roots = { cwd: '/work' }
  const row = new ToolRowView(item, () => roots, false, () => false, () => '  ')
  const first = row.render(60)
  expect(row.render(60)).toBe(first)

  // The Session's directory decides what the row prints, so a new one redraws it.
  roots.cwd = '/elsewhere'
  expect(row.render(60)).not.toBe(first)
})

test('a cached row still follows the client language', () => {
  const item: TranscriptItem = {
    kind: 'tool',
    name: 'read',
    args: JSON.stringify({ file_path: '/work/README.md' }),
    result: Array.from({ length: 30 }, (_, line) => `line ${line}`).join('\n'),
    status: 'ok',
    time: 0,
  }
  if (item.kind !== 'tool') throw new Error('unreachable')
  const row = new ToolRowView(item, () => ({ cwd: '/work' }), false, () => true, () => '  ')
  expect(row.render(60).join('\n')).toContain('+10 lines')

  // A switch only asks for a repaint; the row's own labels come from `t()`.
  setActiveLanguage('zh-CN')
  expect(row.render(60).join('\n')).toContain('+10 行')
})

test('a reasoning row answers a settled thought with the same line', () => {
  const item: TranscriptItem = { kind: 'reasoning', text: 'thinking about it', streaming: false, time: 0 }
  if (item.kind !== 'reasoning') throw new Error('unreachable')
  const theme = buildTheme(false).markdown
  const row = new ThinkRow(item, false, theme, () => 'summary', () => '  ')
  const first = row.render(60)
  expect(row.render(60)).toBe(first)
  item.text = 'thinking about it more'
  expect(row.render(60)).not.toBe(first)
})
