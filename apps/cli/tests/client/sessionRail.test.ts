import { expect, test } from 'bun:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { TerminalSession } from '../../src/tui/data/remote.js'
import {
  railLists,
  relativeTimeLabel,
  sameDirectory,
  SessionRail,
  sessionLabel,
  spinnerFrame,
  SPINNER_FRAMES,
  type RailState,
} from '../../src/tui/view/sessionRail.js'

const NOW = 1_800_000_000_000

const strip = (line: string): string => line.replace(/\u001b\[[0-9;]*m/gu, '')

function session(overrides: Partial<TerminalSession> & { sessionId: string }): TerminalSession {
  return {
    updatedAt: NOW - 60_000,
    running: false,
    blank: false,
    cwd: '/workspace',
    ...overrides,
  }
}

function state(overrides: Partial<RailState> = {}): RailState {
  return {
    sessions: [
      session({ sessionId: 'session-current', title: '修 TUI 会话面板', updatedAt: NOW - 3 * 60_000 }),
      session({ sessionId: 'session-idle', title: '侧栏焦点方案', updatedAt: NOW - 2 * 3_600_000 }),
    ],
    cwd: '/workspace',
    currentId: 'session-current',
    query: '',
    allExpanded: false,
    revealed: false,
    pageRows: 30,
    now: NOW,
    ...overrides,
  }
}

interface Harness {
  rail: SessionRail
  opened: string[]
  created: number
  queries: string[]
  folds: boolean[]
  reveals: boolean[]
  refreshed: number
}

function harness(overrides: Partial<RailState> = {}, rows = 12): Harness {
  const opened: string[] = []
  const queries: string[] = []
  const folds: boolean[] = []
  const reveals: boolean[] = []
  const result: Harness = { rail: undefined as unknown as SessionRail, opened, created: 0, queries, folds, reveals, refreshed: 0 }
  let current = state({ pageRows: Math.max(1, rows - 4), ...overrides })
  result.rail = new SessionRail({
    state: () => current,
    rows: () => rows,
    color: false,
    onOpen: id => { opened.push(id) },
    onNew: () => { result.created += 1 },
    onQuery: query => { queries.push(query); current = { ...current, query } },
    onAllExpanded: (expanded) => { folds.push(expanded); current = { ...current, allExpanded: expanded } },
    onRevealed: (revealed) => { reveals.push(revealed); current = { ...current, revealed } },
    onRefresh: () => { result.refreshed += 1 },
  })
  return result
}

test('the running indicator turns through the braille frames once a second tenth', () => {
  expect(spinnerFrame(0)).toBe(SPINNER_FRAMES[0])
  expect(spinnerFrame(100)).toBe(SPINNER_FRAMES[1])
  expect(spinnerFrame(1_000)).toBe(SPINNER_FRAMES[0])
})

test('relative time uses the Web client buckets', () => {
  expect(relativeTimeLabel(NOW - 10_000, NOW)).toBe('now')
  expect(relativeTimeLabel(NOW - 5 * 60_000, NOW)).toBe('5m')
  expect(relativeTimeLabel(NOW - 3 * 3_600_000, NOW)).toBe('3h')
  expect(relativeTimeLabel(NOW - 2 * 86_400_000, NOW)).toBe('2d')
  expect(relativeTimeLabel(NOW - 65 * 86_400_000, NOW)).toBe('2mo')
  expect(relativeTimeLabel(NOW - 800 * 86_400_000, NOW)).toBe('2y')
})

test('a trailing separator is the same directory', () => {
  expect(sameDirectory('/workspace/', '/workspace')).toBe(true)
  expect(sameDirectory('/workspace', '/workspace-2')).toBe(false)
  expect(sameDirectory(undefined, '/workspace')).toBe(false)
})

test('blank Sessions only appear while they are the open one', () => {
  const lists = railLists(state({
    currentId: 'session-fresh',
    sessions: [
      session({ sessionId: 'session-fresh', blank: true }),
      session({ sessionId: 'session-old-blank', blank: true }),
      session({ sessionId: 'session-filled', title: 'Old work' }),
    ],
  }))
  expect(lists.current.map(entry => entry.sessionId)).toEqual(['session-fresh', 'session-filled'])
  expect(sessionLabel(session({ sessionId: 'session-fresh', blank: true }))).toBe('新会话')
  expect(sessionLabel(session({ sessionId: 'abcdefgh-1234' }))).toBe('abcd…1234')
})

test('a title outranks the blank placeholder', () => {
  // The Host titles a Session as soon as its first prompt lands, while the
  // client's own fresh row may still carry the blank flag from creation; the
  // row has to rename itself from the journal instead of staying `新会话`.
  expect(sessionLabel(session({ sessionId: 'session-fresh', blank: true, title: 'Hacker and Trader X Bio' })))
    .toBe('Hacker and Trader X Bio')
})

test('the current directory heads the list and `all` holds the rest', () => {
  const sessions = [
    session({ sessionId: 'here-new', title: 'here new', updatedAt: NOW - 1_000 }),
    session({ sessionId: 'there', title: 'there', cwd: '/elsewhere' }),
    session({ sessionId: 'here-old', title: 'here old', updatedAt: NOW - 9_000 }),
  ]
  const folded = railLists(state({ sessions }))
  expect(folded.current.map(entry => entry.sessionId)).toEqual(['here-new', 'here-old'])
  expect(folded.foreign).toEqual([])

  const unfolded = railLists(state({ sessions, allExpanded: true }))
  expect(unfolded.foreign.map(entry => entry.sessionId)).toEqual(['there'])
})

test('a query searches the current directory first and stays inside it while `all` is folded', () => {
  const sessions = [
    session({ sessionId: 'here-1', title: 'rail work' }),
    session({ sessionId: 'there-1', title: 'rail elsewhere', cwd: '/elsewhere' }),
  ]
  const folded = railLists(state({ sessions, query: 'rail' }))
  expect(folded.current.map(entry => entry.sessionId)).toEqual(['here-1'])
  expect(folded.foreign).toEqual([])

  const unfolded = railLists(state({ sessions, query: 'rail', allExpanded: true }))
  expect(unfolded.current.map(entry => entry.sessionId)).toEqual(['here-1'])
  expect(unfolded.foreign.map(entry => entry.sessionId)).toEqual(['there-1'])
})

test('the rail paints the path, the filter box, the rows and the folded `all`', () => {
  const test = harness()
  const lines = test.rail.render(20).map(strip)
  expect(lines).toHaveLength(12)
  expect(lines[0]).toBe('/workspace'.padEnd(20))
  expect(lines[1]).toBe('> search'.padEnd(20))
  expect(lines[2]?.trimEnd()).toBe('+ 新会话')
  expect(lines[3]).toStartWith('▸ 修 TUI 会话面板')
  expect(lines[3]?.trimEnd()).toEndWith('3m')
  expect(lines[4]?.trimEnd()).toEndWith('2h')
  expect(lines[11]).toBe('▸ all'.padEnd(20))
  for (const line of lines) expect(visibleWidth(line)).toBe(20)
})

test('a running Session shows its spinner instead of the current marker', () => {
  const test = harness({
    sessions: [session({ sessionId: 'session-current', title: 'running now', running: true })],
  })
  const lines = test.rail.render(20).map(strip)
  expect(lines[3]?.startsWith('⠋')).toBe(true)
})

test('Ctrl-N, Ctrl-P and Vim j/k move the cursor like the arrows', () => {
  const test = harness()
  test.rail.selectCurrent('session-current')
  test.rail.handleInput('\u000e') // Ctrl-N
  test.rail.handleInput('\r')
  expect(test.opened).toEqual(['session-idle'])
  test.rail.startEditing('session-idle')
  test.rail.handleInput('k')
  test.rail.handleInput('\r')
  expect(test.opened).toEqual(['session-idle', 'session-current'])
  test.rail.startEditing('session-current')
  test.rail.handleInput('j')
  test.rail.handleInput('\r')
  expect(test.opened).toEqual(['session-idle', 'session-current', 'session-idle'])
  test.rail.startEditing('session-idle')
  test.rail.handleInput('\u0010') // Ctrl-P
  test.rail.handleInput('\r')
  expect(test.opened.at(-1)).toBe('session-current')
})

test('Enter opens the cursor row, `n` creates, `r` refreshes', () => {
  const test = harness()
  test.rail.selectCurrent('session-idle')
  test.rail.handleInput('\r')
  expect(test.opened).toEqual(['session-idle'])
  test.rail.handleInput('n')
  expect(test.created).toBe(1)
  test.rail.handleInput('r')
  expect(test.refreshed).toBe(1)
  expect(test.folds).toEqual([])
})

test('the `all` row is the last cursor stop and Enter folds it', () => {
  const test = harness()
  test.rail.selectCurrent('session-current')
  test.rail.handleInput('\r')
  expect(test.opened).toEqual(['session-current'])
  test.rail.handleInput('\u001b[B') // down twice: idle Session, then `all`
  test.rail.handleInput('\u001b[B')
  test.rail.handleInput('\r')
  expect(test.folds).toEqual([true])
  test.rail.handleInput('\u001b[D') // left folds again
  expect(test.folds).toEqual([true, false])
})

test('the filter box takes typing, filters, and clears on Escape', () => {
  const test = harness()
  test.rail.handleInput('/')
  expect(test.rail.filterFocused).toBe(true)
  test.rail.handleInput('r')
  test.rail.handleInput('a')
  test.rail.handleInput('i')
  expect(test.queries).toEqual(['r', 'ra', 'rai'])
  // Enter opens the first matching row, never the `+ 新会话` action.
  test.rail.handleInput('\r')
  expect(test.created).toBe(0)
  expect(test.opened).toEqual([])
  test.rail.handleInput('\u007f') // backspace
  expect(test.queries.at(-1)).toBe('ra')
  test.rail.handleInput('\u001b')
  expect(test.queries.at(-1)).toBe('')
  expect(test.rail.filterFocused).toBe(false)
})

test('a long list scrolls so the cursor stays inside the window', () => {
  const sessions = Array.from({ length: 12 }, (_, index) => session({
    sessionId: `session-${index}`,
    title: `title ${index}`,
    updatedAt: NOW - index * 1_000,
  }))
  // Keep the page larger than the list here: this test is about the window.
  const test = harness({ sessions, currentId: 'session-0', pageRows: 30 }, 8)
  test.rail.selectCurrent('session-0')
  // 8 rows: path, filter, five list rows, `all`.
  const first = test.rail.render(20).map(strip)
  expect(first[2]?.trimEnd()).toBe('+ 新会话')
  expect(first[3]?.startsWith('▸ title 0')).toBe(true)
  for (let press = 0; press < 6; press += 1) test.rail.handleInput('\u001b[B')
  const scrolled = test.rail.render(20).map(strip)
  expect(scrolled[7]).toBe('▸ all'.padEnd(20))
  expect(scrolled.slice(2, 7).some(line => line.includes('title 6'))).toBe(true)
  expect(scrolled.slice(2, 7).some(line => line.startsWith('+ 新会话'))).toBe(false)
})

test('entering the rail puts the cursor on the open Session', () => {
  const test = harness()
  test.rail.handleInput('\u001b[B')
  test.rail.startEditing('session-idle')
  test.rail.handleInput('\r')
  expect(test.opened).toEqual(['session-idle'])
})

test('the current directory shows one page of 30 with a More row', () => {
  const sessions = Array.from({ length: 45 }, (_, index) => session({
    sessionId: `session-${index}`,
    title: `title ${index}`,
    updatedAt: NOW - index * 1_000,
  }))
  const lists = railLists(state({ sessions, currentId: 'session-0' }))
  expect(lists.current).toHaveLength(30)
  expect(lists.hidden).toBe(15)
  expect(lists.total).toBe(45)

  const test = harness({ sessions, currentId: 'session-0' }, 40)
  const lines = test.rail.render(24).map(strip)
  expect(lines.some(line => line.includes('↓ More · 15'))).toBe(true)
  expect(lines.some(line => line.includes('title 44'))).toBe(false)
})

test('a running or open Session pulls the page out far enough to stay visible', () => {
  const sessions = Array.from({ length: 45 }, (_, index) => session({
    sessionId: `session-${index}`,
    title: `title ${index}`,
    updatedAt: NOW - index * 1_000,
    running: index === 34,
  }))
  const running = railLists(state({ sessions, currentId: 'session-0' }))
  expect(running.current).toHaveLength(35)
  expect(running.current.at(-1)?.sessionId).toBe('session-34')

  const currentLast = railLists(state({
    sessions: sessions.map(entry => ({ ...entry, running: false })),
    currentId: 'session-44',
  }))
  expect(currentLast.current).toHaveLength(45)
  expect(currentLast.hidden).toBe(0)
})

test('the automatic raise stops at 50 and More reveals the rest', () => {
  const sessions = Array.from({ length: 80 }, (_, index) => session({
    sessionId: `session-${index}`,
    title: `title ${index}`,
    updatedAt: NOW - index * 1_000,
    running: index === 70,
  }))
  const capped = railLists(state({ sessions, currentId: 'session-0' }))
  expect(capped.current).toHaveLength(50)
  expect(capped.hidden).toBe(30)

  const revealed = railLists(state({ sessions, currentId: 'session-0', revealed: true }))
  expect(revealed.current).toHaveLength(80)
  expect(revealed.hidden).toBe(0)
})

test('a query shows every match instead of a page', () => {
  const sessions = Array.from({ length: 45 }, (_, index) => session({
    sessionId: `session-${index}`,
    title: `rail ${index}`,
    updatedAt: NOW - index * 1_000,
  }))
  const lists = railLists(state({ sessions, currentId: 'session-0', query: 'rail' }))
  expect(lists.current).toHaveLength(45)
  expect(lists.hidden).toBe(0)
})

test('Enter on the More row reveals the section, and Less folds it back', () => {
  const sessions = Array.from({ length: 45 }, (_, index) => session({
    sessionId: `session-${index}`,
    title: `title ${index}`,
    updatedAt: NOW - index * 1_000,
  }))
  const test = harness({ sessions, currentId: 'session-0' }, 40)
  // Cursor on `session-0`; 30 rows down is the More row at the end of the page.
  test.rail.selectCurrent('session-0')
  for (let step = 0; step < 30; step += 1) test.rail.handleInput('j')
  test.rail.handleInput('\r')
  expect(test.reveals).toEqual([true])
  const lines = test.rail.render(24).map(strip)
  expect(lines.some(line => line.includes('↑ Less'))).toBe(true)
  test.rail.handleInput('\r')
  expect(test.reveals).toEqual([true, false])
})

test('the More row is the row after the page, inside the scroll', () => {
  const sessions = Array.from({ length: 45 }, (_, index) => session({
    sessionId: `session-${index}`,
    title: `title ${index}`,
    updatedAt: NOW - index * 1_000,
  }))
  const test = harness({ sessions, currentId: 'session-0' }, 10)
  test.rail.selectCurrent('session-0')
  // 10 rows: header, filter, seven list rows and the `all` row. A short window
  // shows fewer Sessions (6 fit below `+ 新会话`), so More follows row 6 and is
  // one line below the fold until the cursor walks down to it.
  const start = test.rail.render(24).map(strip)
  expect(start).toHaveLength(10)
  expect(start[8]?.trimEnd()).not.toContain('More')
  expect(start[9]?.trimEnd()).toBe('▸ all')
  for (let step = 0; step < 6; step += 1) test.rail.handleInput('j')
  const scrolled = test.rail.render(24).map(strip)
  expect(scrolled[8]?.trimEnd()).toBe('↓ More · 39')
  expect(scrolled[9]?.trimEnd()).toBe('▸ all')
  // Enter right there reveals the rest; the row becomes Less in the same slot.
  test.rail.handleInput('\r')
  const revealed = test.rail.render(24).map(strip)
  expect(revealed[8]?.trimEnd()).toBe('↑ Less')
})
