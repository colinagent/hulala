/**
 * Row above the editor: the working directory (left).
 *
 * Only the rail-less frames use it: while the session rail is painted its header
 * already carries the path, so the dock drops this row. When the rail is put
 * away — `Shift-Cmd-S`, or a terminal too narrow for three columns — this row is the
 * only place the directory is visible.
 *
 * The line also yields to the composer's completion menu: while a slash command
 * or path completion is showing, the menu is the only thing above the input.
 *
 * @module hulala-cli/tui/view/cwdBar
 */
import type { Component } from '@earendil-works/pi-tui'
import { buildStyles } from './theme.js'
import { padEnd, shortenPath } from './pathText.js'

export interface CwdBarState {
  cwd: string
  /** The composer's completion menu is open and owns the row above the input. */
  hidden: boolean
}

export class CwdBar implements Component {
  constructor(
    private readonly state: () => CwdBarState,
    private readonly color: boolean,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.state()
    if (state.hidden) return []
    const styles = buildStyles(this.color)
    const cwdText = shortenPath(state.cwd, width)
    return [padEnd(styles.dim(cwdText), width)]
  }
}
