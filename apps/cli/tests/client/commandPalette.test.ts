import { expect, test } from 'bun:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import { parseKeymap, setActiveKeymap } from '../../src/keymap.js'
import { commandCatalog } from '../../src/tui/commandCatalog.js'
import { setActiveLanguage } from '../../src/tui/i18n/index.js'
import { CommandPaletteOverlay } from '../../src/tui/view/overlays/commandPalette.js'

/** A palette collecting whatever it resolves. */
function makePalette(rows = 40): { palette: CommandPaletteOverlay; resolved: Array<string | undefined> } {
  setActiveLanguage('en')
  setActiveKeymap(parseKeymap({}))
  const resolved: Array<string | undefined> = []
  const palette = new CommandPaletteOverlay({
    color: false,
    rows: () => rows,
    onResolve: entry => resolved.push(entry?.name),
  })
  return { palette, resolved }
}

test('the list is grouped and each row carries its shortcut', () => {
  const { palette } = makePalette()
  const text = palette.render(78).join('\n')
  // The first window holds the Session and Model groups and the start of Layout;
  // the counter reports the rest, so every command is reachable.
  for (const name of ['Session', 'Model', 'Layout']) expect(text).toContain(name)
  expect(text).toContain('/sessions')
  expect(text).toContain('(1/24)')
  // The shortcut sits after the description on the same row.
  const thinking = text.split('\n').find(line => line.includes('/thinking')) ?? ''
  expect(thinking).toContain('Shift-Tab')
  expect(thinking.indexOf('Shift-Tab')).toBeGreaterThan(thinking.indexOf('thinking level'))
  // A row below the first window is reached by typing, and keeps its shortcut.
  for (const char of 'editor') palette.handleInput(char)
  const row = palette.render(78).join('\n').split('\n').find(line => line.includes('/editor')) ?? ''
  expect(row).toContain('Ctrl-D')
  expect(row.indexOf('Ctrl-D')).toBeGreaterThan(row.indexOf('nvim'))
})

test('typing filters by name and by what the command does', () => {
  const { palette } = makePalette()
  for (const char of 'nvim') palette.handleInput(char)
  const text = palette.render(78).join('\n')
  expect(text).toContain('/nvim')
  expect(text).not.toContain('/sessions')
  for (let index = 0; index < 4; index += 1) palette.handleInput('\u007f')
  for (const char of 'rail') palette.handleInput(char)
  const byDescription = palette.render(78).join('\n')
  expect(byDescription).toContain('/rail')
  expect(byDescription).not.toContain('/sessions')
})

test('Enter runs the highlighted command and Escape closes without one', () => {
  const first = makePalette()
  first.palette.handleInput('\u001b[B') // Down: /sessions → /new
  first.palette.handleInput('\r')
  expect(first.resolved).toEqual(['new'])

  const second = makePalette()
  second.palette.handleInput('\u001b')
  expect(second.resolved).toEqual([undefined])
})

test('the list stays inside a narrow terminal instead of painting past it', () => {
  const { palette } = makePalette(24)
  for (const width of [78, 60, 44, 34]) {
    for (const line of palette.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
  }
})

test('the command that needs an argument is marked, so the caller can prefill it', () => {
  const rename = commandCatalog().find(entry => entry.name === 'rename')
  expect(rename?.requiresArgument).toBe(true)
  expect(commandCatalog().find(entry => entry.name === 'editor')?.requiresArgument).toBeUndefined()
})
