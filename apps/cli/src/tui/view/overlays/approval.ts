/**
 * Tool approval modal.
 *
 * DSH's per-request approval seam only grants `allowed-once`; `rejected` and
 * `cancelled` are the other outcomes. Escape never dismisses the modal so the
 * user must make an explicit choice.
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

export interface ApprovalOverlayOptions {
  toolName: string
  reason?: string
  color: boolean
  onDecide(outcome: TerminalApprovalOutcome): void
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
    const footer = [s.accent(t('approval.footer'))]
    return panel(panelWidth, t('approval.title'), body, footer)
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
    if (matchesKey(data, 'n')) {
      this.options.onDecide('rejected')
      return
    }
    // Escape is intentionally ignored: the user must choose.
  }
}
