/**
 * File-changed-on-disk conflict, asked instead of guessed.
 *
 * The autosave block in `init.lua` refuses to write a buffer whose file the
 * agent has rewritten (a forced write would clobber the agent, an unforced one
 * blocks on Neovim's y/N) and reports the conflict through a small marker file.
 * The client turns that marker into this dialog, so the decision belongs to the
 * user — the same shape as VS Code's "Overwrite / Revert" prompt, which belongs
 * in the app's UI rather than in the document.
 *
 * @module hulala-cli/tui/view/overlays/conflict
 */
import type { Component } from '@earendil-works/pi-tui'
import { matchesKey } from '@earendil-works/pi-tui'
import { t } from '../../i18n/index.js'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'

/** What the user decided about a buffer whose file changed on disk. */
export type ConflictChoice = 'keep' | 'reload' | 'later'

export interface ConflictOverlayOptions {
  readonly color: boolean
  /** Path of the file that changed underneath the buffer. */
  readonly path: string
  onChoose(choice: ConflictChoice): void
}

export class ConflictOverlay implements Component {
  private readonly options: ConflictOverlayOptions

  constructor(options: ConflictOverlayOptions) {
    this.options = options
  }

  invalidate(): void {}

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    // The name leads so the message survives a narrow panel; the full path is
    // there when it fits and is clipped when it does not.
    const name = this.options.path.split('/').pop() ?? this.options.path
    const body: string[] = [
      t('conflict.body', { name }),
      s.dim(this.options.path),
      s.dim(t('conflict.detail')),
    ]
    const footer = [s.accent(t('conflict.footer'))]
    return panel(width, t('conflict.title'), body, footer)
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'escape')) {
      this.options.onChoose('later')
      return
    }
    if (matchesKey(data, 'k')) {
      this.options.onChoose('keep')
      return
    }
    if (matchesKey(data, 'r')) {
      this.options.onChoose('reload')
      return
    }
  }
}
