/**
 * First-use and `/language` picker.
 *
 * The card is deliberately bilingual in its title and option labels: it is the
 * one surface shown before a language exists, so neither choice may depend on
 * already understanding the other. The footer and any read error follow the
 * active table.
 *
 * @module hulala-cli/tui/view/overlays/language
 */
import type { Component } from '@earendil-works/pi-tui'
import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { LanguageCode, LanguageProblem } from '../../../language.js'
import { languageProblemText, t } from '../../i18n/index.js'
import { listMove } from '../../keys.js'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'

export interface LanguageOverlayOptions {
  readonly color: boolean
  /** The language in use now; `/language` opens with the cursor on it. */
  readonly current: LanguageCode
  /** First use only: the locale guess, which positions the cursor but decides nothing. */
  readonly guess?: LanguageCode
  /** First use only: why the saved language could not be used. */
  readonly problem?: LanguageProblem
  onChoose(code: LanguageCode): void
  onCancel(): void
}

/** The two rows, in cursor order. */
const OPTIONS: readonly LanguageCode[] = ['en', 'zh-CN']

export class LanguageOverlay implements Component {
  private readonly options: LanguageOverlayOptions
  private cursor: number

  constructor(options: LanguageOverlayOptions) {
    this.options = options
    const start = options.guess ?? options.current
    this.cursor = Math.max(0, OPTIONS.indexOf(start))
  }

  invalidate(): void {}

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const inner = width - 4
    const body: string[] = []
    if (this.options.problem !== undefined) {
      body.push(s.warn(truncateToWidth(languageProblemText(this.options.problem), inner)))
      body.push('')
    }
    for (const [index, code] of OPTIONS.entries()) {
      const label = code === 'en' ? t('language.optionEn') : t('language.optionZh')
      const line = `${index === this.cursor ? '›' : ' '} ${label}`
      body.push(index === this.cursor ? s.accent(line) : line)
    }
    return panel(width, t('language.title'), body, [s.dim(t('language.footer'))])
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'escape')) {
      this.options.onCancel()
      return
    }
    if (listMove(data, 'up')) {
      this.cursor = Math.max(0, this.cursor - 1)
      return
    }
    if (listMove(data, 'down')) {
      this.cursor = Math.min(OPTIONS.length - 1, this.cursor + 1)
      return
    }
    if (data === '1' || data === '2') {
      const code = OPTIONS[Number(data) - 1]
      if (code !== undefined) this.options.onChoose(code)
      return
    }
    if (matchesKey(data, 'enter')) {
      const code = OPTIONS[this.cursor]
      if (code !== undefined) this.options.onChoose(code)
    }
  }
}
