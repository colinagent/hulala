/**
 * One child process in a pty plus the screen model that renders it.
 *
 * Both columns beside the transcript are this class: the editor's Neovim and
 * the user's shell. The process owns its colours, keymaps and output exactly as
 * it would in a plain terminal; the client sits in the middle as an ordinary
 * terminal emulator.
 *
 * - bytes from the pty are fed into libghostty-vt (`ghostty-vt.wasm`), which
 *   parses them into a screen model — the same engine family as the terminal the
 *   client runs inside;
 * - a render pass reads the visible viewport back as styled lines, and
 *   `ScreenPane` hands them to pi-tui.
 *
 * No VT parsing happens here on purpose: width handling, SGR, alternate screens
 * and reflow belong to the engine. Rendering is driven by output rather than by
 * a timer, so an idle process produces no frames at all.
 *
 * There is history only where the column asked for it: the terminal pages back
 * through output that scrolled off, while the editor has its own buffers and
 * scrolling and never needs the pane to keep any.
 *
 * @module hulala-cli/tui/pane/screenSession
 */
import { CURSOR_MARKER, renderFakeCursor } from '@earendil-works/pi-tui'
import type { PtyModule, PtyProcess } from '../editor/pty.js'
import { GhosttyVt } from './ghosttyVt.js'

const RESET = '\u001b[0m'

/**
 * How the cell under the program cursor is drawn.
 *
 * - `focused`: emit pi-tui's cursor marker and fake cursor, which renders as a
 *   filled reverse-video block — a shell never paints a cursor of its own.
 * - `dim`: the same block faded into the background, which is what the column
 *   shows while the keyboard is in the other one. The block is a low blend of the theme's
 *   foreground into its background, with the character cut out in the background
 *   colour, because a cell background has no alpha (see `faintCursorSgr`).
 * - `none`: no cursor (a scrolled-back viewport, or a hidden column).
 */
export type CursorKind = 'focused' | 'dim' | 'none'

/**
 * Fallback for a dim cursor when colour output is disabled: the largest hollow
 * glyph the bundled font offers. It spans the full cell width but only part of
 * the height; there is no full-cell outline glyph.
 */
const HOLLOW_CURSOR = '□'

export interface ScreenSessionOptions {
  readonly pty: PtyModule
  /** Program to run in the pty. */
  readonly command: string
  readonly args: readonly string[]
  /** Extra environment on top of this process's own; `TERM` is always set. */
  readonly env: Record<string, string | undefined>
  /** Working directory for the child. */
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  /** Lines of history kept above the live screen; 0 disables scrolling. */
  readonly scrollback?: number
  /** Called after output has been parsed and the screen changed. */
  readonly onScreen: () => void
  /** Called once the child process is gone. */
  readonly onExit: (exitCode: number) => void
}

export class ScreenSession {
  private readonly vt: GhosttyVt
  private readonly child: PtyProcess
  private readonly history: boolean
  private readonly encoder = new TextEncoder()
  private disposed = false
  private height: number

  private constructor(options: ScreenSessionOptions) {
    this.history = (options.scrollback ?? 0) > 0
    this.height = options.rows
    this.vt = new GhosttyVt(options.cols, options.rows)
    this.child = options.pty.spawn(options.command, [...options.args], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: { ...process.env, ...options.env, TERM: 'xterm-256color' },
    })
    this.child.onData(data => {
      if (this.disposed) return
      // Parsing is synchronous: by the time the callback returns the screen model
      // already holds the new frame, so the repaint reads what the program wrote.
      this.vt.write(this.encoder.encode(data))
      options.onScreen()
    })
    this.child.onExit(event => {
      if (this.disposed) return
      this.disposed = true
      this.vt.dispose()
      options.onExit(event.exitCode)
    })
  }

  /**
   * Start a program in `cwd`.
   * @param options - pty module, executable, environment, size and callbacks.
   * @returns the running session.
   */
  static start(options: ScreenSessionOptions): ScreenSession {
    return new ScreenSession(options)
  }

  /** Forward raw keyboard bytes to the program. */
  input(data: string): void {
    if (this.disposed) return
    this.child.write(data)
  }

  /** Resize both the pty and the screen model; no-op when unchanged. */
  resize(cols: number, rows: number): void {
    if (this.disposed) return
    if (this.vt.columns === cols && this.height === rows) return
    this.vt.resize(cols, rows)
    this.height = rows
    this.child.resize(cols, rows)
  }

  /**
   * ANSI background the program paints most of its cells with, or `''` for the
   * terminal default.
   *
   * The split divider uses it so the column reads as the program's left edge
   * instead of a third colour between the two sides. The engine reports the
   * terminal's effective background, which is what a program that recolours the
   * screen through OSC 11 (Neovim) sets.
   * @returns an SGR background sequence, possibly empty.
   */
  backgroundAnsi(): string {
    if (this.disposed) return ''
    return this.vt.backgroundAnsi()
  }

  /**
   * Visible screen rows as ANSI strings, exactly one per requested row.
   *
   * The viewport is wherever paging left it, so a scrolled-back row shows
   * history instead of the live screen. New output does not move it: the engine
   * keeps the viewport offset, which is what makes reading history while a
   * command still runs possible.
   *
   * The program's cell under the cursor is drawn as a reverse-video block
   * (`renderFakeCursor` + `CURSOR_MARKER`, pi-tui's composer-cursor mechanism).
   * A column without focus draws the same cell as a ghost of it instead, so both
   * columns show where their cursor is.
   * @param width - pane width in cells.
   * @param height - pane height in rows.
   * @param cursor - how to draw the cell under the program cursor.
   * @param faintSgr - SGR for the dim block; `''` falls back to the hollow glyph.
   * @returns one styled line per row.
   */
  renderScreen(width: number, height: number, cursor: CursorKind, faintSgr: string): string[] {
    if (this.disposed) return []
    this.resize(width, height)
    const where = cursor === 'none' ? undefined : this.vt.cursor()
    const ink = cursor === 'none'
      ? undefined
      : {
          draw: (text: string): string => {
            if (cursor === 'focused') return CURSOR_MARKER + renderFakeCursor(text === '' ? ' ' : text)
            if (faintSgr === '') return RESET + HOLLOW_CURSOR
            return `${RESET}${faintSgr}${text === '' ? ' ' : text}${RESET}`
          },
        }
    return this.vt.renderRows(width, height, where, ink)
  }

  /**
   * Whether a full-screen program owns the column, i.e. the screen is the
   * alternate screen. Those programs (`fzf`, a pager, an editor in the shell)
   * use `Esc` themselves, so the client must not take it for focus switching.
   * @returns true while the program paints the alternate screen.
   */
  alternateScreen(): boolean {
    if (this.disposed) return false
    return this.vt.alternateScreen()
  }

  /**
   * Whether paging keys belong to this pane rather than to the program.
   *
   * True only for a session started with history, on the normal screen, with
   * something behind the live screen. A full-screen program (`less`, `top`)
   * owns the alternate screen and keeps its own `PageUp`, and an editor with no
   * history passes every key straight through.
   * @returns true when `scrollPages` would do something.
   */
  scrollable(): boolean {
    if (this.disposed || !this.history) return false
    const bar = this.vt.scrollbar()
    return !this.vt.alternateScreen() && bar.total > bar.length
  }

  /**
   * Page the viewport through history.
   * @param pages - negative scrolls back, positive forward.
   * @returns true when the viewport moved, so the caller repaints.
   */
  scrollPages(pages: number): boolean {
    if (!this.scrollable()) return false
    const before = this.vt.scrolledBack()
    this.vt.scrollDelta(pages * Math.max(1, this.height))
    return this.vt.scrolledBack() !== before
  }

  /**
   * Return to the live screen, which is what any typing should do.
   * @returns true when the viewport moved.
   */
  follow(): boolean {
    if (this.disposed || !this.history) return false
    if (this.vt.scrolledBack() === 0) return false
    this.vt.scrollToBottom()
    return true
  }

  /**
   * Lines between the top of the viewport and the live screen's bottom.
   * @returns 0 while the pane shows the live screen.
   */
  scrolledBack(): number {
    if (this.disposed) return 0
    return this.vt.scrolledBack()
  }

  /** Stop the child and release the screen model. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.vt.dispose()
    try {
      this.child.kill()
    } catch {
      // The process is already gone; nothing left to stop.
    }
  }
}
