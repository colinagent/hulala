import { expect, test } from 'bun:test'
import { editorOwnsEscape } from '../../src/tui/pane/focus.js'

test('Neovim keeps Ctrl-[ in every mode except normal', () => {
  for (const mode of ['i', 'ic', 'R', 'v', 'V', 'c', 'no']) {
    expect(editorOwnsEscape(mode)).toBe(true)
  }
  expect(editorOwnsEscape('n')).toBe(false)
  // No report yet means Neovim is still starting in normal mode.
  expect(editorOwnsEscape(undefined)).toBe(false)
})
