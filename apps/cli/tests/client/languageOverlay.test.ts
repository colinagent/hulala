import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { setActiveLanguage, t } from '../../src/tui/i18n/index.js'
import { slashCommands } from '../../src/tui/keys.js'
import { HelpOverlay } from '../../src/tui/view/overlays/help.js'
import { LanguageOverlay } from '../../src/tui/view/overlays/language.js'

beforeEach(() => setActiveLanguage('en'))
afterEach(() => setActiveLanguage('en'))

function overlay(options: Partial<ConstructorParameters<typeof LanguageOverlay>[0]> = {}): {
  view: LanguageOverlay
  chosen: string[]
  cancelled(): number
} {
  const chosen: string[] = []
  let cancelled = 0
  const view = new LanguageOverlay({
    color: false,
    current: 'en',
    onChoose: code => chosen.push(code),
    onCancel: () => { cancelled += 1 },
    ...options,
  })
  return { view, chosen, cancelled: () => cancelled }
}

describe('language picker', () => {
  test('is bilingual and shows both choices with the footer', () => {
    const { view } = overlay()
    const text = view.render(64).join('\n')
    expect(text).toContain(t('language.title'))
    expect(text).toContain('English')
    expect(text).toContain('中文（简体）')
    expect(text).toContain('You can change this later with /language')
    expect(text).toContain('› English')
  })

  test('the locale guess only positions the cursor', () => {
    const { view } = overlay({ guess: 'zh-CN' })
    expect(view.render(64).join('\n')).toContain('› 中文（简体）')
    expect(view.render(64).join('\n')).not.toContain('› English')
  })

  test('Enter chooses the highlighted language', () => {
    const { view, chosen } = overlay({ guess: 'zh-CN' })
    view.handleInput('\r')
    expect(chosen).toEqual(['zh-CN'])
  })

  test('arrows move, and both numbers choose directly', () => {
    const down = overlay()
    down.view.handleInput('\u001b[B')
    down.view.handleInput('\r')
    expect(down.chosen).toEqual(['zh-CN'])

    const two = overlay()
    two.view.handleInput('2')
    expect(two.chosen).toEqual(['zh-CN'])

    const one = overlay({ current: 'zh-CN' })
    one.view.handleInput('1')
    expect(one.chosen).toEqual(['en'])
  })

  test('Escape and Ctrl-C cancel without choosing', () => {
    const escape = overlay()
    escape.view.handleInput('\u001b')
    expect(escape.chosen).toEqual([])
    expect(escape.cancelled()).toBe(1)

    const ctrlC = overlay()
    ctrlC.view.handleInput('\u0003')
    expect(ctrlC.chosen).toEqual([])
    expect(ctrlC.cancelled()).toBe(1)
  })

  test('reports why it is asking again', () => {
    const { view } = overlay({ problem: { kind: 'environment', value: 'klingon' } })
    const text = view.render(80).join('\n')
    expect(text).toContain('HULALA_LANG=klingon')
  })

  test('switching the table changes the footer and the slash descriptions', () => {
    setActiveLanguage('zh-CN')
    const { view } = overlay()
    expect(view.render(64).join('\n')).toContain('之后可以用 /language 修改')
    expect(slashCommands().find(command => command.name === 'help')?.description).toBe('显示命令')
    const help = new HelpOverlay({ color: false, onClose: () => undefined }).render(74).join('\n')
    expect(help).toContain('帮助')
    expect(help).toContain('修改界面语言')
    expect(help).toContain('任意键关闭')
  })
})
