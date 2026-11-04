import { expect, test } from 'bun:test'
import { paneForSwitch, paneOwnsEscape } from '../../src/tui/pane/focus.js'

test('Neovim keeps Ctrl-[ in every mode except normal', () => {
  for (const mode of ['i', 'ic', 'R', 'v', 'V', 'c', 'no']) {
    expect(paneOwnsEscape('editor', { editorMode: mode, alternateScreen: false })).toBe(true)
  }
  expect(paneOwnsEscape('editor', { editorMode: 'n', alternateScreen: false })).toBe(false)
  // No report yet means Neovim is still starting in normal mode.
  expect(paneOwnsEscape('editor', { editorMode: undefined, alternateScreen: false })).toBe(false)
})

test('the shell keeps Ctrl-[ only while a full-screen program owns the screen', () => {
  expect(paneOwnsEscape('terminal', { editorMode: undefined, alternateScreen: true })).toBe(true)
  expect(paneOwnsEscape('terminal', { editorMode: undefined, alternateScreen: false })).toBe(false)
})

test('Ctrl-] prefers the visible column, then the last live one, then any live one', () => {
  const live = (...kinds: Array<'editor' | 'terminal'>) => (kind: 'editor' | 'terminal') => kinds.includes(kind)
  // The painted column wins even when both are alive.
  expect(paneForSwitch({ visible: 'terminal', last: 'editor' }, live('editor', 'terminal'))).toBe('terminal')
  // A closed sidebar reopens the column it showed last, while its process lives.
  expect(paneForSwitch({ visible: undefined, last: 'editor' }, live('editor'))).toBe('editor')
  expect(paneForSwitch({ visible: undefined, last: 'terminal' }, live('editor', 'terminal'))).toBe('terminal')
  // A dead last column falls through to whichever process is still alive.
  expect(paneForSwitch({ visible: undefined, last: 'terminal' }, live('editor'))).toBe('editor')
  // Nothing alive means the key stays the composer's.
  expect(paneForSwitch({ visible: undefined, last: undefined }, live())).toBeUndefined()
})
