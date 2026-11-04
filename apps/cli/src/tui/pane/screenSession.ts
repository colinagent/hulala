/**
 * One child process in a pty plus the screen model that renders it.
 *
 * Both columns beside the transcript are this class: the editor's Neovim and
 * the user's shell. The process owns its colours, keymaps and output exactly as
 * it would in a plain terminal; the client sits in the middle as an ordinary
 * terminal emulator.
 *
 * - bytes from the pty are fed into `@xterm/headless`, which parses escape
 *   sequences into cells (the same package, and the same major version, that
 *   the Host already uses for terminal screen recovery);
 * - a render pass reads those cells back out as ANSI-styled lines, which
 *   `ScreenPane` hands to pi-tui.
 *
 * No VT parsing happens here on purpose: width handling, SGR, alternate screens
 * and reflow are xterm's job. Rendering is driven by output rather than by a
 * timer, so an idle process produces no frames at all.
 *
 * There is no history: the one column runs an editor with its own buffers and
 * scrolling, so the pane never pages and no key is held back for it.
 *
 * @module hulala-cli/tui/pane/screenSession
 */
import { CURSOR_MARKER, renderFakeCursor } from '@earendil-works/pi-tui'
import { Terminal, type IBufferCell } from '@xterm/headless'
import type { PtyModule, PtyProcess } from '../editor/pty.js'

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
  /** Called after output has been parsed and the screen changed. */
  readonly onScreen: () => void
  /** Called once the child process is gone. */
  readonly onExit: (exitCode: number) => void
}

/** Build one SGR parameter list for a cell, or `''` for plain default text. */
function cellSgr(cell: IBufferCell): string {
  let sgr = ''
  if (cell.isBold() !== 0) sgr += ';1'
  if (cell.isDim() !== 0) sgr += ';2'
  if (cell.isItalic() !== 0) sgr += ';3'
  if (cell.isUnderline() !== 0) sgr += ';4'
  if (cell.isBlink() !== 0) sgr += ';5'
  if (cell.isInverse() !== 0) sgr += ';7'
  if (cell.isStrikethrough() !== 0) sgr += ';9'
  const fg = cell.getFgColor()
  if (cell.isFgRGB()) sgr += `;38;2;${(fg >> 16) & 0xff};${(fg >> 8) & 0xff};${fg & 0xff}`
  else if (cell.isFgPalette()) sgr += `;38;5;${fg}`
  const bg = cell.getBgColor()
  if (cell.isBgRGB()) sgr += `;48;2;${(bg >> 16) & 0xff};${(bg >> 8) & 0xff};${bg & 0xff}`
  else if (cell.isBgPalette()) sgr += `;48;5;${bg}`
  return sgr
}

export class ScreenSession {
  private readonly screen: Terminal
  private readonly child: PtyProcess
  private disposed = false
  private background: string | undefined
  private backgroundRevision = -1
  /** Bumped whenever the parsed screen changes, so caches can key on it. */
  private revision = 0

  private constructor(options: ScreenSessionOptions) {
    this.screen = new Terminal({
      cols: options.cols,
      rows: options.rows,
      allowProposedApi: true,
    })
    this.child = options.pty.spawn(options.command, [...options.args], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: { ...process.env, ...options.env, TERM: 'xterm-256color' },
    })
    this.child.onData(data => {
      if (this.disposed) return
      // Parse first, then repaint: `write` is queued, so reading straight after
      // it would show the previous frame.
      this.screen.write(data, () => {
        if (this.disposed) return
        this.revision += 1
        options.onScreen()
      })
    })
    this.child.onExit(event => {
      if (this.disposed) return
      this.disposed = true
      // The caller drops the pane, but the parse model is ours to release.
      this.screen.dispose()
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
    if (this.screen.cols === cols && this.screen.rows === rows) return
    this.screen.resize(cols, rows)
    this.child.resize(cols, rows)
    this.revision += 1
  }

  /**
   * ANSI background the program paints most of its cells with, or `''` for the
   * terminal default. The split divider uses it so the column reads as the
   * program's left edge instead of a third colour between the two sides.
   *
   * The most common background wins rather than the cell at (0,0): an open
   * file tree or a floating window owns the top-left corner, and its background
   * is not the program's own. Cached briefly, because this runs while painting.
   * @returns an SGR background sequence, possibly empty.
   */
  backgroundAnsi(): string {
    if (this.disposed) return ''
    if (this.background !== undefined && this.backgroundRevision === this.revision) return this.background
    const buffer = this.screen.buffer.active
    const rows = this.screen.rows
    const cols = this.screen.cols
    const counts = new Map<string, number>()
    for (let y = 0; y < rows; y += 2) {
      const line = buffer.getLine(buffer.viewportY + y)
      if (line === undefined) continue
      for (let x = 0; x < cols; x += 2) {
        const cell = line.getCell(x)
        if (cell === undefined) continue
        // Only cells the program painted explicitly count: the majority that
        // carry no background already render in the terminal's own colour,
        // which is what the conversation beside them uses.
        if (cell.isBgDefault()) continue
        const value = cell.getBgColor()
        const key = cell.isBgRGB() ? `r${value}` : `p${value}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    let best = 'default'
    let bestCount = 0
    for (const [key, count] of counts) {
      if (count > bestCount) {
        bestCount = count
        best = key
      }
    }
    let ansi = ''
    if (best.startsWith('r')) {
      const rgb = Number(best.slice(1))
      ansi = `\u001b[48;2;${(rgb >> 16) & 0xff};${(rgb >> 8) & 0xff};${rgb & 0xff}m`
    } else if (best.startsWith('p')) {
      ansi = `\u001b[48;5;${Number(best.slice(1))}m`
    }
    this.background = ansi
    this.backgroundRevision = this.revision
    return ansi
  }

  /**
   * Visible screen rows as ANSI strings, exactly one per requested row.
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
    const buffer = this.screen.buffer.active
    const cursorX = Math.max(0, Math.min(width - 1, buffer.cursorX))
    const cursorY = Math.max(0, Math.min(height - 1, buffer.cursorY - buffer.viewportY))
    const lines: string[] = []
    for (let y = 0; y < height; y += 1) {
      const line = buffer.getLine(buffer.viewportY + y)
      if (line === undefined) {
        lines.push(' '.repeat(width))
        continue
      }
      let text = ''
      let open = ''
      let marked = false
      for (let x = 0; x < width; x += 1) {
        const cell = line.getCell(x)
        if (cell === undefined) break
        // A wide glyph owns its cell and reports width 2; the cell after it
        // reports width 0 and must not emit a second copy of the character.
        if (cell.getWidth() === 0) continue
        const sgr = cellSgr(cell)
        if (sgr !== open) {
          text += `${RESET}${sgr === '' ? '' : `\u001b[${sgr.slice(1)}m`}`
          open = sgr
        }
        const chars = cell.getChars() || ' '
        if (cursor !== 'none' && !marked && y === cursorY && x >= cursorX) {
          if (cursor === 'dim') {
            // Half-opacity block, or the hollow glyph when colour is disabled.
            // The reset matters: the following cell may be default-coloured and
            // would otherwise inherit the block's colours.
            text += faintSgr === '' ? RESET + HOLLOW_CURSOR : `${RESET}${faintSgr}${chars}${RESET}`
          } else {
            // The marker lets pi-tui resolve the fake cursor to reverse video
            // and keeps the cell's position available for the IME.
            text += CURSOR_MARKER + renderFakeCursor(chars)
          }
          marked = true
          // The cursor cell no longer carries the program's own SGR, so the next
          // cell must restate its attributes.
          open = ''
          continue
        }
        text += chars
      }
      // Cursor past the last cell of the row: there is no cell to draw on, so
      // only the marker can place the terminal cursor.
      if (cursor === 'focused' && !marked && y === cursorY) text += CURSOR_MARKER
      lines.push(text + RESET)
    }
    return lines
  }

  /** Stop the program and release the screen model. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    try {
      this.child.kill()
    } catch {
      // The process may already be gone; disposal must stay total.
    }
    this.screen.dispose()
  }
}
