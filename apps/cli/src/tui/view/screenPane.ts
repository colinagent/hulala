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
import { matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { CursorKind } from '../pane/screenSession.js'
import { buildStyles } from './theme.js'
import { padEnd } from './pathText.js'

/** History paging, present only on sessions started with scrollback. */
export interface PaneScroll {
  /** True while paging keys belong to the pane instead of the program. */
  scrollable(): boolean
  /** Scroll by whole pages; true when the viewport moved. */
  scrollPages(pages: number): boolean
  /** Return to the live screen; true when the viewport moved. */
  follow(): boolean
  /** Lines between the top of the viewport and the live screen's bottom. */
  scrolledBack(): number
}

/** The half of a session this view needs. */
export interface PaneScreen {
  resize(cols: number, rows: number): void
  renderScreen(width: number, height: number, cursor: CursorKind, faintSgr: string): string[]
  input(data: string): void
}

export interface ScreenPaneOptions {
  readonly screen: PaneScreen
  /**
   * History paging, for sessions started with scrollback. Absent means every
   * key belongs to the program, which is the editor column's case.
   */
  readonly scroll?: PaneScroll | undefined
  /** Rows available to the pane, from the surrounding layout. */
  readonly rows: () => number
  readonly color: boolean
  /**
   * SGR for the faded cursor block shown without focus; `''` falls back
   * to a hollow glyph.
   */
  readonly faintCursor?: () => string
  /** Paging moved the viewport; the caller repaints. */
  readonly onScroll?: () => void
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
    const history = this.options.scroll?.scrolledBack() ?? 0
    // A scrolled-back viewport has no program cursor on screen to mark. A column
    // without focus keeps showing it faded, so the cursor does not disappear
    // when the keyboard moves to the other column.
    const cursor: CursorKind = history > 0 ? 'none' : this.focused ? 'focused' : 'dim'
    const lines = this.options.screen.renderScreen(width, height, cursor, this.options.faintCursor?.() ?? '')
    const fitted = lines.length === 0
      ? Array.from({ length: height }, () => ' '.repeat(width))
      : lines.map(line => fitToWidth(line, width))
    if (history > 0) fitted[fitted.length - 1] = this.historyRow(width, history)
    return fitted
  }

  handleInput(data: string): void {
    const scroll = this.options.scroll
    if (scroll !== undefined && scroll.scrollable()) {
      // `Shift-PageUp` is the escape hatch that works with a program on the
      // normal screen; plain `PageUp` is the same key in terminals that cannot
      // report the modifier.
      if (matchesKey(data, 'shift+pageUp') || matchesKey(data, 'pageUp')) {
        if (scroll.scrollPages(-1)) this.options.onScroll?.()
        return
      }
      if (matchesKey(data, 'shift+pageDown') || matchesKey(data, 'pageDown')) {
        if (scroll.scrollPages(1)) this.options.onScroll?.()
        return
      }
      // Anything typed means the user is done reading.
      if (scroll.scrolledBack() > 0 && scroll.follow()) this.options.onScroll?.()
    }
    this.options.screen.input(data)
  }

  handleMouse(_event: TuiMouseEvent): TuiMouseEventResult | undefined {
    this.options.onPointer?.()
    return undefined
  }

  invalidate(): void {
    this.lastSize = ''
  }

  /** Bottom row while paging: where the viewport is and how to leave it. */
  private historyRow(width: number, lines: number): string {
    const styles = buildStyles(this.options.color)
    const label = ` history ${lines} lines · Shift-PgDn or any key returns to the latest `
    const fitted = truncateToWidth(label, width, '…')
    const rule = '─'.repeat(Math.max(0, width - visibleWidth(fitted)))
    return styles.dim(rule + fitted)
  }
}

/** Keep one screen row exactly `width` cells wide. */
function fitToWidth(line: string, width: number): string {
  const lineWidth = visibleWidth(line)
  if (lineWidth === width) return line
  if (lineWidth > width) return truncateToWidth(line, width, '')
  return padEnd(line, width)
}
