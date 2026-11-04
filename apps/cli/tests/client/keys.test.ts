import { expect, test } from 'bun:test'
import { KeybindingsManager, TUI_KEYBINDINGS } from '@earendil-works/pi-tui'
import { composerBindings, viewportPagingBindings } from '../../src/tui/keys.js'

const PAGE_UP = '\u001b[5~'
const PAGE_DOWN = '\u001b[6~'
const CTRL_N = '\u000e'
const CTRL_P = '\u0010'

test('the alt-screen viewport pages the transcript with PageUp and PageDown', () => {
  const manager = new KeybindingsManager(TUI_KEYBINDINGS)
  expect(manager.matches(PAGE_UP, 'tui.altScreen.pageUp')).toBe(true)
  expect(manager.matches(PAGE_DOWN, 'tui.altScreen.pageDown')).toBe(true)
})

test('a focused column gets the paging keys instead of the transcript', () => {
  const manager = new KeybindingsManager(TUI_KEYBINDINGS)
  manager.setUserBindings(viewportPagingBindings(false))
  // The keys now fall through pi-tui's listeners to the focused column.
  expect(manager.matches(PAGE_UP, 'tui.altScreen.pageUp')).toBe(false)
  expect(manager.matches(PAGE_DOWN, 'tui.altScreen.pageDown')).toBe(false)
})

test('the transcript gets its paging keys back when focus returns to the composer', () => {
  const manager = new KeybindingsManager(TUI_KEYBINDINGS)
  manager.setUserBindings(viewportPagingBindings(false))
  manager.setUserBindings(viewportPagingBindings(true))
  expect(manager.matches(PAGE_UP, 'tui.altScreen.pageUp')).toBe(true)
  expect(manager.getConflicts()).toEqual([])
})

test('Ctrl-P and Ctrl-N are the arrow keys of the composer', () => {
  const manager = new KeybindingsManager(TUI_KEYBINDINGS)
  manager.setUserBindings(composerBindings(true))
  expect(manager.matches(CTRL_P, 'tui.editor.cursorUp')).toBe(true)
  expect(manager.matches(CTRL_N, 'tui.editor.cursorDown')).toBe(true)
  // The composer's own paging keys are untouched by the extra aliases.
  expect(manager.matches(PAGE_UP, 'tui.altScreen.pageUp')).toBe(true)
})

test('the list arrows coexist with the paging keys a focused column owns', () => {
  const manager = new KeybindingsManager(TUI_KEYBINDINGS)
  manager.setUserBindings(composerBindings(false))
  expect(manager.matches(CTRL_P, 'tui.editor.cursorUp')).toBe(true)
  expect(manager.matches(CTRL_N, 'tui.editor.cursorDown')).toBe(true)
  expect(manager.matches(PAGE_UP, 'tui.altScreen.pageUp')).toBe(false)
  expect(manager.getConflicts()).toEqual([])
})
