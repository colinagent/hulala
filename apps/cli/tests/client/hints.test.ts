import { afterEach, expect, test } from 'bun:test'
import { setCapabilities } from '@earendil-works/pi-tui'
import { parseKeymap, setActiveKeymap } from '../../src/keymap.js'
import { commandCatalog } from '../../src/tui/commandCatalog.js'
import { setActiveLanguage } from '../../src/tui/i18n/index.js'
import { brandBannerLines } from '../../src/tui/view/brandBanner.js'
import { HelpOverlay } from '../../src/tui/view/overlays/help.js'

afterEach(() => {
  setActiveKeymap(parseKeymap({}))
  setActiveLanguage('en')
})

/** The banner and `/help` as plain text. */
function surfaces(): { banner: string; help: string } {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  return {
    banner: brandBannerLines(120).join('\n'),
    help: new HelpOverlay({ color: false, rows: () => 60, onClose: () => undefined }).render(74).join('\n'),
  }
}

test('the default keys are the ones the catalog and the panels print', () => {
  setActiveLanguage('en')
  const hints = Object.fromEntries(commandCatalog().map(entry => [entry.name, entry.hint]))
  // One key per panel, no second spelling.
  expect(hints.editor).toBe('Ctrl-G')
  expect(hints.terminal).toBe('Ctrl-T')
  expect(hints.nvim).toBe('Ctrl-Shift-G')
  expect(hints.rail).toBe('Ctrl-D')
  expect(hints.chat).toBe('Ctrl-F')
  expect(hints.commands).toBe('Shift-Cmd-K / Ctrl-Shift-P')
  expect(hints.quit).toBe('Ctrl-Q')
  const { banner, help } = surfaces()
  expect(banner).toContain('Ctrl-T')
  expect(banner).toContain('Ctrl-G')
  expect(help).toContain('Ctrl-D')
  expect(help).toContain('Ctrl-Shift-G')
})

test('a rebound chord reaches the palette rows, the banner and /help', () => {
  setActiveLanguage('en')
  setActiveKeymap(parseKeymap({
    'panel.terminal': ['alt+t'],
    'panel.rail': ['ctrl+shift+r'],
    'panel.editor': ['ctrl+shift+e'],
  }))
  const hints = Object.fromEntries(commandCatalog().map(entry => [entry.name, entry.hint]))
  expect(hints.terminal).toBe('Alt-T')
  expect(hints.rail).toBe('Ctrl-Shift-R')
  expect(hints.editor).toBe('Ctrl-Shift-E')
  const { banner, help } = surfaces()
  expect(banner).toContain('Alt-T')
  expect(banner).toContain('Ctrl-Shift-E')
  expect(help).toContain('Alt-T')
  expect(help).toContain('Ctrl-Shift-R')
  expect(help).not.toContain('Ctrl-Shift-D')
})

test('a disabled action loses its hint everywhere instead of lying', () => {
  setActiveLanguage('en')
  setActiveKeymap(parseKeymap({ 'panel.chat': [], 'app.quit': [] }))
  const hints = Object.fromEntries(commandCatalog().map(entry => [entry.name, entry.hint]))
  expect(hints.chat).toBe('')
  expect(hints.quit).toBe('')
  const { banner, help } = surfaces()
  expect(banner).not.toContain('Ctrl-F')
  expect(help).not.toContain('Ctrl-F')
  // The panel says the action was disabled instead of leaving a blank cell.
  expect(help).toContain('disabled')
})

test('the help panel follows the interface language it was asked for', () => {
  setActiveLanguage('zh-CN')
  const { help } = surfaces()
  expect(help).toContain('帮助')
  expect(help).toContain('显示命令')
  expect(help).toContain('任意键关闭')
})
