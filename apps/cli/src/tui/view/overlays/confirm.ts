/**
 * Unsaved-editor confirmation.
 *
 * The client asks Neovim to quit first and only opens this when Neovim refuses:
 * it exits when every buffer can be written, and refuses while one cannot (an
 * unnamed draft, a read-only file, a directory that disappeared). The dialog
 * therefore never invents a warning — autosave has already written everything
 * it could.
 *
 * Copy stays in the user's language: no buffer types, error codes or "silent!"
 * wording. Escape and `Ctrl-C` cancel, which is also what a user still pressing
 * the quit key twice expects.
 *
 * @module hulala-cli/tui/view/overlays/confirm
 */
import type { Component } from '@earendil-works/pi-tui'
import { matchesKey } from '@earendil-works/pi-tui'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'

/** What the user decided about the editor's unwritten buffers. */
export type ConfirmChoice = 'save' | 'discard' | 'cancel'

export interface ConfirmOverlayOptions {
  readonly color: boolean
  /** True when the previous "save all" attempt did not clear the buffers. */
  readonly failedSave?: boolean
  onChoose(choice: ConfirmChoice): void
}

export class ConfirmOverlay implements Component {
  private readonly options: ConfirmOverlayOptions

  constructor(options: ConfirmOverlayOptions) {
    this.options = options
  }

  invalidate(): void {}

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const body: string[] = ['有未保存的文件']
    if (this.options.failedSave === true) body.push(s.dim('保存失败，文件可能不可写'))
    const footer = [s.accent('[s] 保存全部  [d] 放弃改动  [Esc] 取消')]
    return panel(width, '编辑器', body, footer)
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'escape')) {
      this.options.onChoose('cancel')
      return
    }
    if (matchesKey(data, 's')) {
      this.options.onChoose('save')
      return
    }
    if (matchesKey(data, 'd')) {
      this.options.onChoose('discard')
      return
    }
  }
}
