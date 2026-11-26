/**
 * Tool approval modal.
 *
 * DSH's per-request approval seam only grants `allowed-once`; `rejected` and
 * `cancelled` are the other outcomes. `full-access` is the client's own intent:
 * it widens this Session's permission preset first and then answers
 * `allowed-once`, so the rest of this thread stops asking. Escape never
 * dismisses the modal so the user must make an explicit choice.
 *
 * @module hulala-cli/tui/view/overlays/approval
 */
import type { Component } from '@earendil-works/pi-tui'
import { matchesKey } from '@earendil-works/pi-tui'
import type { TerminalApprovalOutcome } from '../../data/remote.js'
import { t } from '../../i18n/index.js'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'
import type { ImePolicy } from '../../pane/focus.js'

/**
 * What the user chose in the approval modal.
 *
 * The first three are Host outcomes; `full-access` is answered as
 * `allowed-once` after the caller switches the Session's permission preset.
 * `delegate` hands the request to the next answerer on the waterfall — the
 * channel mounted to this Session, or another client — without rejecting it.
 */
export type ApprovalDecision = TerminalApprovalOutcome | 'full-access' | 'delegate'

export interface ApprovalOverlayOptions {
  toolName: string
  reason?: string
  color: boolean
  /**
   * Terminal rows, when the caller knows them. The reason is a sentence the
   * model wrote, so the panel needs a ceiling it would not need for its own
   * labels; without one a long reason pushes the keys off screen.
   */
  rows?: number
  onDecide(decision: ApprovalDecision): void
}

export class ApprovalOverlay implements Component {
  /** Keys here are an instruction, not writing: the client switches to English. */
  imePolicy: ImePolicy = 'command'
  private readonly options: ApprovalOverlayOptions

  constructor(options: ApprovalOverlayOptions) {
    this.options = options
  }

  invalidate(): void {}

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const panelWidth = width
    const body: string[] = [s.accent(this.options.toolName)]
    if (this.options.reason !== undefined && this.options.reason !== '') {
      body.push(s.dim(this.options.reason))
    }
    body.push(s.dim(t('approval.fullAccessHint')))
    body.push(s.dim(t('approval.fullAccessDetail')))
    body.push(s.dim(t('approval.delegateHint')))
    const footer = [s.accent(t('approval.footer'))]
    // The terminal's rows are not all the body's to spend: the two borders and
    // the footer are the panel's own, and a row above and below keep it off the
    // frame's edges. What is left is the reason's budget.
    const rows = this.options.rows
    return panel(panelWidth, t('approval.title'), body, footer, rows === undefined
      ? {}
      : { maxBodyRows: Math.max(3, rows - 5) })
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'ctrl+c')) {
      this.options.onDecide('cancelled')
      return
    }
    if (matchesKey(data, 'y')) {
      this.options.onDecide('allowed-once')
      return
    }
    if (matchesKey(data, 'f')) {
      this.options.onDecide('full-access')
      return
    }
    if (matchesKey(data, 'n')) {
      this.options.onDecide('rejected')
      return
    }
    if (matchesKey(data, 'd')) {
      this.options.onDecide('delegate')
      return
    }
    // Escape is intentionally ignored: the user must choose.
  }
}
