/**
 * Right-hand column: a viewport onto one running program.
 *
 * The pane owns no program behaviour. It forwards keys to the pty and paints
 * whatever the screen model reports, which is what makes the column identical
 * to running the program in a normal terminal: same shell, same Vim, same
 * plugins, same file tree.
 *
 * The one thing it does own is paging a session that keeps history. A shell is
 * read, not just typed into, and the client runs in the alternate screen where the
 * outer terminal's scrollback is unavailable — so the pane keeps its own
 * history and pages it, while an editor (no history) passes every key through.
 * Typing always returns to the live screen, and the bottom row then says where
 * the viewport is and how to get back.
 *
 * The pty is resized from `render()` rather than from a terminal resize event,
 * because the pane width is only decided by the layout at paint time. Resizing
 * anywhere else can leave the program drawing outside the column.
 *
 * @module hulala-cli/tui/view/screenPane
 */
import type { Component, Focusable, TuiMouseEvent, TuiMouseEventResult } from '@earendil-works/pi-tui'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { CursorKind } from '../pane/screenSession.js'
import { padEnd } from './pathText.js'

/** The half of a session this view needs. */
export interface PaneScreen {
  resize(cols: number, rows: number): void
  renderScreen(width: number, height: number, cursor: CursorKind, faintSgr: string): string[]
  input(data: string): void
}

export interface ScreenPaneOptions {
  readonly screen: PaneScreen
  /** Rows available to the pane, from the surrounding layout. */
  readonly rows: () => number
  readonly color: boolean
  /**
   * SGR for the faded cursor block shown without focus; `''` falls back
   * to a hollow glyph.
   */
  readonly faintCursor?: () => string
  /** The pointer entered the pane, which ends any divider hover. */
  readonly onPointer?: () => void
}

export class ScreenPane implements Component, Focusable {
  focused = false
  private lastSize = ''

  constructor(private readonly options: ScreenPaneOptions) {}

  render(width: number): string[] {
    const height = Math.max(1, this.options.rows())
    const size = `${width}x${height}`
    // Only when the column actually changed: this runs on every repaint.
    if (size !== this.lastSize) {
      this.lastSize = size
      this.options.screen.resize(width, height)
    }
    // A column without focus keeps showing a ghost of its cursor, so it
    // does not disappear when the keyboard moves to the composer.
    const cursor: CursorKind = this.focused ? 'focused' : 'dim'
    const lines = this.options.screen.renderScreen(width, height, cursor, this.options.faintCursor?.() ?? '')
    return lines.length === 0
      ? Array.from({ length: height }, () => ' '.repeat(width))
      : lines.map(line => fitToWidth(line, width))
  }

  handleInput(data: string): void {
    this.options.screen.input(data)
  }

  handleMouse(_event: TuiMouseEvent): TuiMouseEventResult | undefined {
    this.options.onPointer?.()
    return undefined
  }

  invalidate(): void {
    this.lastSize = ''
  }
}

/** Keep one screen row exactly `width` cells wide. */
function fitToWidth(line: string, width: number): string {
  const lineWidth = visibleWidth(line)
  if (lineWidth === width) return line
  if (lineWidth > width) return truncateToWidth(line, width, '')
  return padEnd(line, width)
}
