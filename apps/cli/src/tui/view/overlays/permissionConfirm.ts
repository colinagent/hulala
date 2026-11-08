/**
 * Full-access confirmation.
 *
 * `danger-full-access` also carries the `never` approval policy, so after this
 * choice the Host stops asking before tool calls. The dialog states that once,
 * the same way the Web client's risk gate does, and takes a single explicit
 * key: `y` accepts, `n` and `Esc` keep the current preset.
 *
 * @module hulala-cli/tui/view/overlays/permissionConfirm
 */
import type { Component } from '@earendil-works/pi-tui'
import { matchesKey } from '@earendil-works/pi-tui'
import { t } from '../../i18n/index.js'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'

export interface PermissionConfirmOptions {
  readonly color: boolean
  onDecide(accepted: boolean): void
}

export class PermissionConfirmOverlay implements Component {
  private readonly options: PermissionConfirmOptions

  constructor(options: PermissionConfirmOptions) {
    this.options = options
  }

  invalidate(): void {}

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const body = [
      t('confirm.permission.body'),
      s.dim(t('confirm.permission.detail')),
    ]
    const footer = [s.accent(t('confirm.permission.footer'))]
    return panel(width, t('confirm.permission.title'), body, footer)
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'escape') || matchesKey(data, 'n')) {
      this.options.onDecide(false)
      return
    }
    if (matchesKey(data, 'y')) this.options.onDecide(true)
  }
}
