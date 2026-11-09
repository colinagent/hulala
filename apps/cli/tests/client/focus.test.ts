import { expect, test } from 'bun:test'
import { imePolicyOf, modeReadsText, paneForSwitch, paneOwnsEscape } from '../../src/tui/pane/focus.js'

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


test('insert, replace and select modes are where Neovim reads text', () => {
  for (const mode of ['i', 'ic', 'ix', 'R', 'Rc', 'Rx', 's', 'S']) {
    expect(modeReadsText(mode)).toBe(true)
  }
  // Everything else is an instruction: motions, visual ranges, `:` commands and
  // a terminal buffer, which is a program reading keys of its own.
  for (const mode of ['n', 'no', 'nov', 'v', 'V', '\u0016', 'c', 'cv', 't']) {
    expect(modeReadsText(mode)).toBe(false)
  }
  // Nothing reported yet is Neovim's startup state, normal mode.
  expect(modeReadsText(undefined)).toBe(false)
})

test('a surface that declares nothing reads text', () => {
  expect(imePolicyOf({})).toBe('text')
  expect(imePolicyOf({ imePolicy: undefined })).toBe('text')
  expect(imePolicyOf({ imePolicy: 'nonsense' })).toBe('text')
  expect(imePolicyOf({ imePolicy: 'text' })).toBe('text')
  expect(imePolicyOf({ imePolicy: 'command' })).toBe('command')
})
