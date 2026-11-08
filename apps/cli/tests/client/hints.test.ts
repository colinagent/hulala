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
  expect(hints.editor).toBe('Ctrl-D')
  expect(hints.terminal).toBe('Ctrl-T')
  expect(hints.nvim).toBe('Cmd-E')
  expect(hints.rail).toBe('Shift-Cmd-S')
  expect(hints.chat).toBe('Shift-Cmd-C')
  expect(hints.commands).toBe('Shift-Cmd-P')
  expect(hints.quit).toBe('Ctrl-Q')
  const { banner, help } = surfaces()
  expect(banner).toContain('Ctrl-T')
  expect(banner).toContain('Ctrl-D')
  expect(help).toContain('Ctrl-D')
  expect(help).toContain('Shift-Cmd-S')
})

test('a rebound chord reaches the palette rows, the banner and /help', () => {
  setActiveLanguage('en')
  setActiveKeymap(parseKeymap({
    'panel.terminal': ['alt+t'],
    'panel.rail': ['ctrl+g'],
    'panel.editor': ['ctrl+f'],
  }))
  const hints = Object.fromEntries(commandCatalog().map(entry => [entry.name, entry.hint]))
  expect(hints.terminal).toBe('Alt-T')
  expect(hints.rail).toBe('Ctrl-G')
  expect(hints.editor).toBe('Ctrl-F')
  const { banner, help } = surfaces()
  expect(banner).toContain('Alt-T')
  expect(banner).toContain('Ctrl-F')
  expect(help).toContain('Alt-T')
  expect(help).toContain('Ctrl-G')
  expect(banner).not.toContain('Shift-Cmd-S')
})

test('a disabled action loses its hint everywhere instead of lying', () => {
  setActiveLanguage('en')
  setActiveKeymap(parseKeymap({ 'panel.chat': [], 'app.quit': [] }))
  const hints = Object.fromEntries(commandCatalog().map(entry => [entry.name, entry.hint]))
  expect(hints.chat).toBe('')
  expect(hints.quit).toBe('')
  const { banner, help } = surfaces()
  expect(banner).not.toContain('Shift-Cmd-C')
  expect(help).not.toContain('Shift-Cmd-C')
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
