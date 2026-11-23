/**
 * The welcome block: what the conversation opens with.
 *
 * Two things are pinned here. The order — banner, then what the Session loaded,
 * then anything a launch has to say — because that order is the whole reason the
 * block exists: the once-per-release changelog used to be a home screen that
 * replaced the banner instead of printing below it. And the block's own text
 * rules: sorted names, comma wrapping, and nothing at all when there is nothing
 * to say.
 */
import { expect, test } from 'bun:test'
import { setCapabilities, stripTerminalSequences } from '@earendil-works/pi-tui'
import { VERSION } from '../../src/constants.js'
import { Welcome } from '../../src/tui/view/welcome.js'
import { Transcript } from '../../src/tui/view/transcript.js'
import type { TranscriptItem } from '../../src/tui/data/viewModel.js'

/** The rows as a reader sees them, with the mark's escape sequences gone. */
function plain(lines: readonly string[]): string[] {
  return lines.map(line => stripTerminalSequences(line))
}

/** Index of the first row that says `needle`, or -1. */
function rowOf(lines: readonly string[], needle: string): number {
  return lines.findIndex(line => line.includes(needle))
}

test('the facts print under the banner, one bracket heading per inventory', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const welcome = new Welcome(false)
  welcome.setFacts({ skills: ['release-hulala', 'agent-notes'], mcp: ['memory'] })
  const lines = plain(welcome.render(100))
  // Row 0 is the mark's own placement; the wordmark sits beside it on row 1.
  expect(rowOf(lines, `hulala v${VERSION}`)).toBe(1)
  // Alphabetical, one comma list, indented under its heading.
  expect(lines[rowOf(lines, '[Skills]') + 1]).toBe('  agent-notes, release-hulala')
  expect(lines[rowOf(lines, '[MCP]') + 1]).toBe('  memory')
})

test('nothing loaded is a banner and no heading at all', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const welcome = new Welcome(false)
  welcome.setFacts({ skills: [], mcp: [] })
  const lines = plain(welcome.render(100))
  expect(rowOf(lines, '[Skills]')).toBe(-1)
  expect(rowOf(lines, '[MCP]')).toBe(-1)
  expect(lines.length).toBe(plain(new Welcome(false).render(100)).length)
})

test('one inventory with names does not drag in the empty one', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const welcome = new Welcome(false)
  welcome.setFacts({ skills: [], mcp: ['repo-graph'] })
  const lines = plain(welcome.render(100))
  expect(rowOf(lines, '[Skills]')).toBe(-1)
  expect(rowOf(lines, '[MCP]')).toBeGreaterThan(0)
})

test('a repeated name is printed once', () => {
  setCapabilities({ images: null, trueColor: false, hyperlinks: false })
  const welcome = new Welcome(false)
  welcome.setFacts({ skills: ['pdf', 'pdf', ' pdf '], mcp: [] })
  expect(plain(welcome.render(80))).toEqual(['[Skills]', '  pdf'])
})

test('a long list wraps at the terminal width instead of losing names', () => {
  setCapabilities({ images: null, trueColor: false, hyperlinks: false })
  const welcome = new Welcome(false)
  const skills = ['agent-notes', 'pdf', 'release-hulala', 'playwright-cli']
  welcome.setFacts({ skills, mcp: [] })
  const lines = plain(welcome.render(30))
  expect(lines[0]).toBe('[Skills]')
  for (const line of lines.slice(1)) {
    expect(line.startsWith('  ')).toBe(true)
    expect(line.length).toBeLessThanOrEqual(30)
  }
  // Every name survives the wrap, in alphabetical order.
  const body = lines.slice(1).map(line => line.trim()).join(', ')
  expect(body).toBe([...skills].sort().join(', '))
})

test('a frame that changed nothing reuses the block it already drew', () => {
  // The transcript compares these rows by identity to keep its document cache;
  // an array rebuilt per frame would invalidate every row of the conversation.
  for (const images of ['kitty', null] as const) {
    setCapabilities({ images, trueColor: true, hyperlinks: false })
    const welcome = new Welcome(false)
    welcome.setFacts({ skills: ['pdf'], mcp: ['memory'] })
    const first = welcome.render(100)
    expect(welcome.render(100)).toBe(first)
    welcome.setFacts({ skills: ['pdf', 'office'], mcp: ['memory'] })
    expect(welcome.render(100)).not.toBe(first)
  }
})

test('the transcript opens with the welcome block, then the changelog', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const welcome = new Welcome(false)
  welcome.setFacts({ skills: ['pdf'], mcp: ['memory'] })
  const transcript = new Transcript(false, () => ({ cwd: '/work' }), welcome)
  // The launch reminder is a transcript row, exactly as `/changelog` announces
  // it: it may follow the welcome block, never replace it.
  transcript.setItems([{ kind: 'notice', text: `Updated to v${VERSION}`, time: 0 }])
  const lines = plain(transcript.render(100))
  const banner = rowOf(lines, `hulala v${VERSION}`)
  const skills = rowOf(lines, '[Skills]')
  const mcp = rowOf(lines, '[MCP]')
  const changelog = rowOf(lines, `Updated to v${VERSION}`)
  expect(banner).toBeGreaterThanOrEqual(0)
  expect(skills).toBeGreaterThan(banner)
  expect(mcp).toBeGreaterThan(skills)
  expect(changelog).toBeGreaterThan(mcp)
})

test('a conversation follows the welcome block instead of replacing it', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const welcome = new Welcome(false)
  welcome.setFacts({ skills: ['pdf'], mcp: [] })
  const transcript = new Transcript(false, () => ({ cwd: '/work' }), welcome)
  transcript.setItems([{ kind: 'user', text: 'hello', time: 0 }])
  const lines = plain(transcript.render(100))
  expect(rowOf(lines, `hulala v${VERSION}`)).toBeGreaterThanOrEqual(0)
  expect(rowOf(lines, '❯ hello')).toBeGreaterThan(rowOf(lines, '[Skills]'))
})

test('a click still finds the row it means under the welcome block', () => {
  setCapabilities({ images: null, trueColor: false, hyperlinks: false })
  const welcome = new Welcome(false)
  welcome.setFacts({ skills: ['pdf', 'agent-notes'], mcp: ['memory'] })
  const transcript = new Transcript(false, () => ({ cwd: '/work' }), welcome)
  const item: TranscriptItem = {
    kind: 'tool',
    name: 'bash',
    args: JSON.stringify({ command: 'ls -la', description: 'List files' }),
    result: '[exit code: 0]',
    status: 'ok',
    time: 0,
    durationMs: 120,
  }
  transcript.setItems([item])
  const lines = plain(transcript.render(80))
  const title = rowOf(lines, '>_ Bash')
  // The hit test works in document coordinates, so the welcome rows above the
  // row are part of the offset it has to know about.
  expect(title).toBeGreaterThan(0)
  expect(lines[title]).toContain('>_ Bash')
  const at = (type: 'move' | 'press' | 'click') => ({
    type, button: 'left' as const, x: 3, y: title,
    screenX: 3, screenY: title, width: 80, height: 14, shift: false, alt: false, ctrl: false,
  })
  expect(transcript.handleMouse(at('move'))).toEqual({ handled: true, render: true })
  expect(plain(transcript.render(80))[title]).toContain('▸ >_ Bash')
  // A press stays free for text selection; the click folds the row.
  expect(transcript.handleMouse(at('press'))).toBeUndefined()
  expect(transcript.handleMouse(at('click'))).toEqual({ handled: true, render: true })
  expect(plain(transcript.render(80))[title]).toContain('▾ >_ Bash')
})
