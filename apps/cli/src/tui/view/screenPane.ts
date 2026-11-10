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
import { compositeTuiLine, matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { CursorKind, CaretShape } from '../pane/screenSession.js'
import { sgrMouse } from './sgrMouse.js'
import { legacyKeys } from '../pane/legacyKeys.js'
import { buildStyles } from './theme.js'
import { padEnd } from './pathText.js'
import type { ImePolicy } from '../pane/focus.js'

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
  /** The caret shape the program inside this pane asks the terminal for. */
  caretShape(): CaretShape
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
  /**
   * The shape the terminal should draw the caret in while this column has the
   * keyboard. Reported from `render`, so the shape on screen is the shape the
   * frame was painted with — a program may change it (Neovim's insert mode)
   * without the keyboard moving at all.
   */
  readonly onCaret?: (shape: CaretShape) => void
  /** Paging moved the viewport; the caller repaints. */
  readonly onScroll?: () => void
  /** The pointer entered the pane, which ends any divider hover. */
  readonly onPointer?: () => void
  /**
   * A divider the program inside this pane draws, reported by the program.
   *
   * Only the editor has one: Neovim's file tree is a split of its own, and the
   * boundary between the tree and the buffer is the same kind of rule as the
   * frame's dividers. Neovim owns the resize (the pointer reports reach it); the
   * client adds what a program cannot: the resize pointer shape, and the accent
   * the rule takes while the pointer rests on it, drawn over the program's cell.
   */
  readonly divider?: PaneDivider
  /**
   * Hand the pointer to the program as terminal mouse reports.
   *
   * Only the editor column sets this: Neovim tracks the mouse (`mouse=a`) and
   * uses it for clicks, selection and the file tree's own divider, while a shell
   * usually does not — and the client cannot see whether a program asked for
   * reports, because the screen model does not expose the modes it parsed.
   */
  readonly mouse?: boolean
}

/** A program-drawn divider this pane reports the pointer for. */
export interface PaneDivider {
  /** Zero-based pane column of the rule, or undefined when it is not drawn. */
  column(): number | undefined
  /** Whether the pointer is resting on it. */
  hovered(): boolean
  setHovered(hovered: boolean): void
}

export class ScreenPane implements Component, Focusable {
  /**
   * Keys here are an instruction, not writing: a column is a program reading raw
   * keys, so the client switches to English. The editor flips this while Neovim
   * is in insert mode and asks the terminal to re-read it.
   */
  imePolicy: ImePolicy = 'command'
  focused = false
  /**
   * A press started on the program's divider and has not been released.
   *
   * The hover has to survive the whole gesture — the same way the frame's own
   * dividers keep their accent while being dragged — even though the pointer
   * leaves the rule column as soon as the boundary starts to follow it.
   */
  private grabbing = false
  private lastSize = ''

  constructor(private readonly options: ScreenPaneOptions) {}

  /**
   * The caret shape the program inside this column asked for.
   *
   * A focused column is the only thing on screen whose cell carries pi-tui's
   * cursor marker, so it is also the only thing that gets to say what shape the
   * terminal's own cursor takes: Neovim's insert mode is a bar, its normal mode
   * a block. This is read when the keyboard moves and whenever the column
   * reports a mode change, not on every frame.
   * @returns the shape to hand to the terminal.
   */
  caretShape(): CaretShape {
    return this.options.screen.caretShape()
  }

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
    // The caret is the terminal's own cursor here, so its shape rides with the
    // frame that carries the marker instead of with the focus change.
    if (cursor === 'focused') this.options.onCaret?.(this.options.screen.caretShape())
    const lines = this.options.screen.renderScreen(width, height, cursor, this.options.faintCursor?.() ?? '')
    const fitted = lines.length === 0
      ? Array.from({ length: height }, () => ' '.repeat(width))
      : lines.map(line => fitToWidth(line, width))
    if (history > 0) fitted[fitted.length - 1] = this.historyRow(width, history)
    this.paintDividerHover(fitted, width)
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
    // The column's program speaks legacy terminal encoding; the outer terminal
    // may be reporting its keys through the Kitty keyboard protocol.
    this.options.screen.input(legacyKeys(data))
  }

  /**
   * Overlay the program's divider cell while the pointer rests on it.
   *
   * The cell keeps the program's own column — Neovim draws its separator there
   * and repaints it on every resize — so only the one cell is replaced, with the
   * same accent the frame's dividers take when hovered.
   */
  private paintDividerHover(lines: string[], width: number): void {
    const divider = this.options.divider
    if (divider === undefined || !divider.hovered()) return
    const column = divider.column()
    if (column === undefined || column < 0 || column >= width) return
    const styles = buildStyles(this.options.color)
    const glyph = styles.accent('▎')
    for (let row = 0; row < lines.length; row += 1) {
      lines[row] = compositeTuiLine(lines[row]!, glyph, column, 1, width)
    }
  }

  /**
   * Forward the pointer, and keep the gesture while it lasts.
   *
   * A press is answered, which is what hands the following drags and the release
   * to this column even when the pointer leaves it: a boundary drag is followed
   * past the pane's own edge.
   *
   * Bare motion is not forwarded (a program only sees it with `mousemoveevent`),
   * but it is what tells the client whether the pointer is on the program's
   * divider — the hover the frame's own dividers have.
   */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    // The frame ends its own divider hovers as soon as the pointer is inside a
    // column. A gesture on the program's own divider must not be ended by that:
    // the pointer is supposed to stay on that rule for as long as it is held.
    if (!this.grabbing) this.options.onPointer?.()
    if (this.options.mouse !== true) return undefined
    const divider = this.options.divider
    if (divider !== undefined) {
      switch (event.type) {
        case 'press':
          this.grabbing = divider.column() === event.x
          divider.setHovered(this.grabbing)
          break
        case 'drag':
          if (this.grabbing) divider.setHovered(true)
          break
        case 'release': {
          const was = this.grabbing
          this.grabbing = false
          if (was) divider.setHovered(divider.column() === event.x)
          break
        }
        case 'move':
          if (!this.grabbing) divider.setHovered(divider.column() === event.x)
          break
        default:
          break
      }
    }
    const report = sgrMouse(event)
    if (report === undefined) return undefined
    this.options.screen.input(report)
    return { handled: true }
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
