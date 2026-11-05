import { expect, test } from 'bun:test'
import {
  editorThemeFromTerminal,
  FALLBACK_THEME,
  HIGHLIGHT_INK,
} from '../../src/tui/editor/editorTheme.js'

test('the theme falls back when the terminal reports nothing', () => {
  expect(editorThemeFromTerminal(undefined)).toBe(FALLBACK_THEME)
  expect(editorThemeFromTerminal({})).toBe(FALLBACK_THEME)
  expect(editorThemeFromTerminal({ background: { r: 1, g: 2, b: 3 } })).toBe(FALLBACK_THEME)
})

test('the editor background is the terminal background, so the split has no seam', () => {
  const theme = editorThemeFromTerminal({
    foreground: { r: 0xc8, g: 0xd3, b: 0xf5 },
    background: { r: 0x1a, g: 0x1b, b: 0x26 },
  })
  expect(theme.background).toBe('#1a1b26')
  expect(theme.foreground).toBe('#c8d3f5')
})

test('syntax accents come from the terminal ANSI palette', () => {
  const palette = [
    { r: 0, g: 0, b: 0 },
    { r: 0xff, g: 0x00, b: 0x00 },
    { r: 0x00, g: 0xff, b: 0x00 },
    { r: 0xff, g: 0xff, b: 0x00 },
    { r: 0x00, g: 0x00, b: 0xff },
    { r: 0xff, g: 0x00, b: 0xff },
    { r: 0x00, g: 0xff, b: 0xff },
    { r: 0xff, g: 0xff, b: 0xff },
  ]
  const theme = editorThemeFromTerminal({
    foreground: { r: 0xff, g: 0xff, b: 0xff },
    background: { r: 0x10, g: 0x10, b: 0x10 },
    palette,
  })
  expect(theme.string).toBe('#00ff00')
  expect(theme.number).toBe('#ffff00')
  expect(theme.keyword).toBe('#ff00ff')
  expect(theme.func).toBe('#0000ff')
  expect(theme.special).toBe('#00ffff')
  expect(theme.error).toBe('#ff0000')
})

test('secondary colours are blends, never the raw foreground', () => {
  const theme = editorThemeFromTerminal({
    foreground: { r: 0xff, g: 0xff, b: 0xff },
    background: { r: 0x00, g: 0x00, b: 0x00 },
  })
  expect(theme.comment).not.toBe(theme.foreground)
  expect(theme.comment).not.toBe(theme.background)
  expect(theme.cursorline).not.toBe(theme.background)
  const value = Number.parseInt(theme.comment.slice(1), 16)
  expect(value).toBeGreaterThan(0)
  expect(value).toBeLessThan(0xffffff)
})

test('the current-location ink is the client\'s own, not a palette entry', () => {
  const palette = Array.from({ length: 16 }, (_, index) => ({ r: index * 4, g: index * 2, b: index }))
  const theme = editorThemeFromTerminal({
    foreground: { r: 0xff, g: 0xff, b: 0xff },
    background: { r: 0x10, g: 0x10, b: 0x10 },
    palette,
  })
  // The rail and the file tree mark the same thing, so they share one ink even
  // on terminals whose palette would suggest something else.
  expect(theme.highlight).toBe(HIGHLIGHT_INK)
  expect(theme.highlight).not.toBe(theme.title)
  expect(FALLBACK_THEME.highlight).toBe(HIGHLIGHT_INK)
})
