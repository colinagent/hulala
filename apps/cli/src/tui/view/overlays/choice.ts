/**
 * One yes/no question about an action the client cannot take back.
 *
 * A remote install or update restarts the Host on another machine, so it is
 * asked once, in the user's language, before anything is fetched or run. The
 * default is always the safe answer: `Enter` confirms, `Esc` and `Ctrl-C` cancel,
 * and a closed window is a cancellation too.
 *
 * @module hulala-cli/tui/view/overlays/choice
 */
import type { Component } from '@earendil-works/pi-tui'
import { matchesKey } from '@earendil-works/pi-tui'
import { t } from '../../i18n/index.js'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'
import type { ImePolicy } from '../../pane/focus.js'

/** What a confirmation came to. */
export type ChoiceResult = 'continue' | 'cancel'

export interface ChoiceOverlayOptions {
  readonly color: boolean
  readonly title: string
  /** Body lines, already localized; wrapped by the panel. */
  readonly body: readonly string[]
  onChoose(choice: ChoiceResult): void
}

export class ChoiceOverlay implements Component {
  /** Keys here are an instruction, not writing: the client switches to English. */
  imePolicy: ImePolicy = 'command'
  private readonly options: ChoiceOverlayOptions

  constructor(options: ChoiceOverlayOptions) {
    this.options = options
  }

  invalidate(): void {}

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const footer = [s.accent(t('choice.footer'))]
    return panel(width, this.options.title, [...this.options.body], footer)
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'escape') || matchesKey(data, 'n')) {
      this.options.onChoose('cancel')
      return
    }
    if (matchesKey(data, 'enter') || matchesKey(data, 'y')) {
      this.options.onChoose('continue')
    }
  }
}
