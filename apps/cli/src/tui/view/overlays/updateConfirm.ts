/**
 * The question `/update` asks before it takes the machine down.
 *
 * Updating stops the shared Host, so it ends every running turn and makes every
 * other window restart. The user pressed the command, so the dialog is not a
 * warning about the unexpected; it is the one place the consequences are named
 * while the decision is still reversible. It lists what it knows — the Host
 * version, the running turns, the columns this window would close — and it says
 * plainly that other windows restart too.
 *
 * `Enter` continues because a confirming user should not have to hunt for a
 * letter; `Esc` and `Ctrl-C` cancel, like every other dialog here.
 *
 * @module hulala-cli/tui/view/overlays/updateConfirm
 */
import type { Component } from '@earendil-works/pi-tui'
import { matchesKey } from '@earendil-works/pi-tui'
import { t } from '../../i18n/index.js'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'
import type { ImePolicy } from '../../pane/focus.js'

/** What the update dialog needs to know about this window. */
export interface UpdateConfirmFacts {
  /** Version being installed. */
  readonly version: string
  /** Turns running anywhere the client can see. */
  readonly running: number
  /** Whether a sidebar column would be closed by the restart. */
  readonly panes: boolean
}

/** Whether the update proceeds. */
export type UpdateChoice = 'continue' | 'cancel'

export interface UpdateConfirmOverlayOptions {
  readonly color: boolean
  readonly facts: UpdateConfirmFacts
  onChoose(choice: UpdateChoice): void
}

export class UpdateConfirmOverlay implements Component {
  /** Keys here are an instruction, not writing: the client switches to English. */
  imePolicy: ImePolicy = 'command'
  constructor(private readonly options: UpdateConfirmOverlayOptions) {}

  invalidate(): void {}

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const { facts } = this.options
    const body: string[] = [t('update.preflight.host', { version: facts.version })]
    if (facts.running > 0) body.push(s.warn(t('update.preflight.running', { count: facts.running })))
    body.push(t('update.preflight.windows'))
    if (facts.panes) body.push(s.dim(t('update.preflight.editor')))
    const footer = [s.accent(t('update.preflight.footer'))]
    return panel(width, t('update.preflight.title'), body, footer)
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      this.options.onChoose('cancel')
      return
    }
    if (matchesKey(data, 'enter') || data === 'y' || data === 'Y') {
      this.options.onChoose('continue')
    }
  }
}
