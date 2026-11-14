/**
 * The editor column as a Neovim UI: cells, highlight attributes and input.
 *
 * This is the client half of the UI protocol. Neovim owns the buffer, the
 * layout and the keys; this module owns what a UI owns — a grid of cells with
 * attribute ids, the cursor, and the mapping from terminal bytes back into key
 * notation. The column keeps rendering through {@link PaneScreen}, so the editor
 * and the terminal share one renderer, one theme and one focus model.
 *
 * @module hulala-cli/tui/editor/nvimUi
 */
import { CURSOR_MARKER, visibleWidth, truncateToWidth } from '@earendil-works/pi-tui'
import { Grid } from './grid.js'
import { decodeKeys, keyNotation, notationOf, type KeyInput } from '../input/keys.js'
import { decodeMsgpack, encodeMsgpack, type Msgpack } from './msgpack.js'
import { sgrSequence } from '../pane/ghosttyVt.js'
import type { CaretShape, CursorKind } from '../pane/screenSession.js'

const RESET = '\u001b[0m'

/** Highlight attributes Neovim defined, in RGB terms. */
interface Attributes {
  foreground?: number
  background?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  undercurl?: boolean
  strikethrough?: boolean
  reverse?: boolean
  /** Characters of the cell (a space) that a list-style highlight paints. */
  blend?: number
}

/** What one UI session needs from its transport. */
export interface NvimUiChannel {
  send(chunk: Uint8Array): void
  /** End the channel; the Host terminates the Neovim it started for it. */
  close(): void
}

export interface NvimUiOptions {
  readonly channel: NvimUiChannel & {
    onData(handler: (chunk: Uint8Array) => void): void
    onExit(handler: (event: { code: number | null }) => void): void
    onProblem(handler: (text: string) => void): void
  }
  readonly cols: number
  readonly rows: number
  /** Whether the terminal can paint 24-bit colour. */
  readonly color: boolean
  /** Called after a `flush`: the grid changed and a repaint is due. */
  readonly onScreen: () => void
  /** Called once when Neovim is gone. */
  readonly onExit: (exitCode: number) => void
  /** Called when the mode changes, so the column can follow it with the input source. */
  readonly onMode?: (mode: string) => void
  /**
   * Neovim's diagnostics.
   *
   * A warning on stderr is not a failure: Neovim keeps running and the column
   * stays usable, so this is something to show, not something to end. A session
   * that really ended announces that through `onExit`.
   */
  readonly onProblem?: (text: string) => void
}

/** Pad or truncate one rendered row to exactly `width` visible cells. */
function fit(line: string, width: number): string {
  const current = visibleWidth(line)
  if (current === width) return line
  if (current > width) return truncateToWidth(line, width, '')
  return line + ' '.repeat(width - current)
}

/** Translate one 0xRRGGBB integer into SGR parameters. */
function colorSgr(select: 38 | 48, value: number): string {
  return `;${select};2;${(value >> 16) & 0xff};${(value >> 8) & 0xff};${value & 0xff}`
}

/** The SGR parameters for one attribute set, with the leading separator `sgrSequence` expects. */
function sgrOf(attributes: Attributes | undefined, color: boolean): string {
  if (attributes === undefined) return ''
  let sgr = ''
  if (attributes.bold === true) sgr += ';1'
  if (attributes.italic === true) sgr += ';3'
  if (attributes.underline === true || attributes.undercurl === true) sgr += ';4'
  if (attributes.strikethrough === true) sgr += ';9'
  if (attributes.reverse === true) sgr += ';7'
  if (!color) return sgr
  if (attributes.foreground !== undefined) sgr += colorSgr(38, attributes.foreground)
  if (attributes.background !== undefined) sgr += colorSgr(48, attributes.background)
  return sgr
}

/** Read one integer field from a decoded map without trusting its type. */
function numberOf(value: Msgpack | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/**
 * One Neovim UI session.
 *
 * Messages arrive as channel chunks that may split a message, so bytes that do
 * not decode yet are kept and prepended to the next chunk. Every request this
 * client sends is a `nvim_input`/`nvim_paste`/`nvim_ui_try_resize` call; Neovim's
 * responses are ignored, because a UI has nothing to do with them.
 */
export class NvimUi {
  private readonly options: NvimUiOptions
  private readonly attributes = new Map<number, Attributes>()
  private readonly defaultColors = { foreground: 0xffffff, background: 0x000000 }
  private grid: Grid
  private cols: number
  private rows: number
  /** Bytes of an incomplete message held for the next chunk. */
  private pending = new Uint8Array()
  private cursor = { row: 0, col: 0 }
  /** Neovim's last reported mode; undefined until it reports one. */
  private mode: string | undefined
  private cursorStyles: Array<{ shape: 'block' | 'bar' | 'underline' }> = []
  private modeIndex = 0
  /** Column Neovim's file tree ends at, when it reports one. */
  private tree: number | undefined
  private nextRequest = 0
  private disposed = false

  constructor(options: NvimUiOptions) {
    this.options = options
    this.cols = options.cols
    this.rows = options.rows
    this.grid = new Grid(options.cols, options.rows)
    // The session owns its channel's plumbing: a column that forgot to subscribe
    // would render a blank grid forever, which is a failure with no symptom.
    options.channel.onData(chunk => this.feed(chunk))
    // One `vim.notify` from a plugin must not close the column: the exit event is
    // what ends a session, and it follows a real failure on its own.
    options.channel.onProblem(text => this.options.onProblem?.(text))
    options.channel.onExit(event => this.fail(event.code ?? -1))
    // The first thing a UI does: become a UI. The channel buffers this until the
    // Host's `ready`, so constructing the grid and opening the column stay one
    // synchronous step.
    this.request('nvim_ui_attach', [options.cols, options.rows, { ext_linegrid: true, rgb: options.color }])
  }

  /**
   * Feed one channel chunk.
   * @param chunk - bytes Neovim wrote to its channel.
   */
  feed(chunk: Uint8Array): void {
    if (this.disposed) return
    const merged = new Uint8Array(this.pending.length + chunk.length)
    merged.set(this.pending)
    merged.set(chunk, this.pending.length)
    const { values, consumed } = decodeMsgpack(merged)
    this.pending = merged.subarray(consumed)
    for (const value of values) this.handle(value)
  }

  /** Report a transport or Neovim failure and end the session. */
  fail(exitCode = -1): void {
    if (this.disposed) return
    this.disposed = true
    this.options.onExit(exitCode)
  }

  /**
   * Route one decoded message: `[2, "redraw", …]` is the only one a UI acts on.
   *
   * Each redraw group is `[name, set1, set2, …]`, and every set is the flat
   * parameter list of one event. `grid_line` batches a whole screen this way, so
   * the sets are applied in order rather than reading `group.slice(1)` as one
   * parameter list — the mistake that leaves a grid blank while events arrive.
   */
  private handle(message: Msgpack): void {
    if (!Array.isArray(message)) return
    const [type, , payload] = message
    if (type !== 2) return
    if (!Array.isArray(payload)) return
    for (const group of payload) {
      if (!Array.isArray(group)) continue
      const [name, ...sets] = group
      for (const set of sets) {
        if (Array.isArray(set)) this.apply(String(name), set)
      }
    }
    this.options.onScreen()
  }

  /** Apply one UI event. */
  private apply(name: string, args: Msgpack[]): void {
    switch (name) {
      case 'grid_resize': {
        const cols = numberOf(args[1]) ?? this.cols
        const rows = numberOf(args[2]) ?? this.rows
        this.cols = cols
        this.rows = rows
        this.grid.reset(cols, rows)
        return
      }
      case 'grid_clear':
        this.grid.clear()
        return
      case 'grid_cursor_goto':
        this.cursor = { row: numberOf(args[1]) ?? 0, col: numberOf(args[2]) ?? 0 }
        return
      case 'grid_scroll': {
        const top = numberOf(args[1])
        const bottom = numberOf(args[2])
        const left = numberOf(args[3])
        const right = numberOf(args[4])
        if (top === undefined || bottom === undefined || left === undefined || right === undefined) return
        this.grid.scroll(top, bottom, left, right, numberOf(args[5]) ?? 0, numberOf(args[6]) ?? 0)
        return
      }
      case 'grid_line': {
        const row = numberOf(args[1])
        const start = numberOf(args[2])
        const cells = args[3]
        if (row === undefined || start === undefined || !Array.isArray(cells)) return
        const text = cells.filter((cell): cell is Msgpack[] => Array.isArray(cell))
          .map(cell => cell.map(value => (typeof value === 'string' || typeof value === 'number' ? value : undefined)))
          .map(cell => cell.filter((value): value is string | number => value !== undefined))
        this.grid.line(row, start, text, args[4] === true)
        return
      }
      case 'hl_attr_define': {
        const id = numberOf(args[0])
        const rgb = args[1]
        if (id === undefined || rgb === null || typeof rgb !== 'object' || Array.isArray(rgb)) return
        const record = rgb as Record<string, Msgpack>
        const foreground = numberOf(record.foreground)
        const background = numberOf(record.background)
        const blend = numberOf(record.blend)
        this.attributes.set(id, {
          ...(foreground === undefined ? {} : { foreground }),
          ...(background === undefined ? {} : { background }),
          ...(record.bold === true ? { bold: true } : {}),
          ...(record.italic === true ? { italic: true } : {}),
          ...(record.underline === true ? { underline: true } : {}),
          ...(record.undercurl === true ? { undercurl: true } : {}),
          ...(record.strikethrough === true ? { strikethrough: true } : {}),
          ...(record.reverse === true ? { reverse: true } : {}),
          ...(blend === undefined ? {} : { blend }),
        })
        return
      }
      case 'default_colors_set': {
        const foreground = numberOf(args[0])
        const background = numberOf(args[1])
        if (foreground !== undefined) this.defaultColors.foreground = foreground
        if (background !== undefined) this.defaultColors.background = background
        return
      }
      case 'mode_info_set': {
        const styles = args[1]
        this.cursorStyles = Array.isArray(styles)
          ? styles.map(style => {
            const shape = style !== null && typeof style === 'object' && !Array.isArray(style)
              ? (style as Record<string, Msgpack>).cursor_shape
              : undefined
            return { shape: shape === 'vertical' ? 'bar' as const : shape === 'horizontal' ? 'underline' as const : 'block' as const }
          })
          : []
        return
      }
      case 'mode_change': {
        this.mode = typeof args[0] === 'string' ? modeLetter(args[0]) : undefined
        this.modeIndex = numberOf(args[1]) ?? 0
        if (this.mode !== undefined) this.options.onMode?.(this.mode)
        return
      }
      default:
        return
    }
  }

  /**
   * Resize the grid the pane gives us.
   *
   * The pane and Neovim are told the same size; when the pane wins a frame, the
   * grid is reshaped here so nothing is drawn outside the column.
   */
  resize(cols: number, rows: number): void {
    if (this.disposed || (cols === this.cols && rows === this.rows)) return
    this.grid.resize(cols, rows)
    this.cols = cols
    this.rows = rows
    this.request('nvim_ui_try_resize', [cols, rows])
  }

  /**
   * Render the grid for {@link PaneScreen}.
   * @param width - pane width in cells.
   * @param height - pane height in rows.
   * @param cursor - how to paint the cell Neovim's cursor is on.
   * @param faintSgr - SGR for the dim block; `''` falls back to the hollow glyph.
   * @returns one styled line per row.
   */
  renderScreen(width: number, height: number, cursor: CursorKind, faintSgr: string): string[] {
    if (this.disposed) return []
    this.resize(width, height)
    const where = cursor === 'none' ? undefined : this.cursor
    const lines: string[] = []
    for (let row = 0; row < height; row += 1) {
      const cells = this.grid.row(row)?.cells ?? []
      let line = ''
      let open = ''
      for (let col = 0; col < width; col += 1) {
        const cell = cells[col]
        // A cell's text is drawn verbatim: `''` is the right half of the wide
        // character before it, and turning it into a space would push the rest
        // of the line two cells to the right of where Neovim put it.
        const text = cell?.text ?? ' '
        const sgr = sgrOf(this.attributes.get(cell?.hl ?? 0), this.options.color)
        if (where !== undefined && where.row === row && where.col === col) {
          // The caret is the terminal's own cursor painted over the cell, so the
          // glyph stays and the marker goes in front of it; a column without
          // focus paints a ghost instead, which is why the SGR and the glyph are
          // both replaced here.
          if (cursor === 'focused') line += `${CURSOR_MARKER}${sgrSequence(sgr)}${text}${RESET}`
          else if (faintSgr === '') line += `${RESET}□`
          else line += `${RESET}${faintSgr}${text}${RESET}`
          open = ''
          continue
        }
        if (sgr !== open) {
          line += RESET + sgrSequence(sgr)
          open = sgr
        }
        line += text
      }
      lines.push(fit(line + RESET, width))
    }
    return lines
  }

  /**
   * Where Neovim's file tree ends, in pane columns.
   *
   * The tree is a split inside Neovim, so only Neovim knows the boundary; the
   * Host reads its report and forwards it, which is what lets the client give
   * that rule the same pointer shape as its own dividers.
   */
  treeEdge(): number | undefined {
    return this.tree
  }

  /** Accept the Host's tree-boundary report. */
  setTreeEdge(column: number | undefined): void {
    this.tree = column
  }

  /** The pane's background: Neovim paints every cell it owns. */
  backgroundAnsi(): string {
    return ''
  }

  /**
   * The editor never owns the alternate screen: it *is* the column, and the
   * column's own frame decides what is behind it.
   */
  alternateScreen(): false {
    return false
  }

  /** The caret shape Neovim asked for in the current mode. */
  caretShape(): CaretShape {
    return this.cursorStyles[this.modeIndex]?.shape ?? 'block'
  }

  /** The mode Neovim last reported, for the input-source policy. */
  currentMode(): string | undefined {
    return this.mode
  }

  /**
   * Forward one keystroke or paste.
   *
   * Printable text goes as text; everything else is key notation, because that
   * is the only form `nvim_input` understands. A bracketed paste becomes
   * `nvim_paste`, which keeps Neovim's own paste semantics (indent, formatting)
   * instead of feeding thousands of `nvim_input` calls.
   */
  input(data: string): void {
    if (this.disposed || data === '') return
    // One decoder owns what the bytes mean: a mouse report is a call, a key is
    // notation, and an unknown sequence is dropped rather than typed.
    let keys = ''
    for (const event of decodeKeys(data)) {
      if (event.kind === 'mouse') {
        const mouse = mouseRequest(event.code, event.x, event.y, event.pressed)
        if (mouse !== undefined) this.request('nvim_input_mouse', mouse)
        continue
      }
      if (event.kind === 'paste') {
        this.request('nvim_paste', [event.text, false, -1])
        continue
      }
      keys += notationOf(event)
    }
    if (keys !== '') this.request('nvim_input', [keys])
  }

  /**
   * Send key notation verbatim.
   *
   * For commands the client itself types into Neovim (leave, discard, save all),
   * where the bytes are already notation and running them through the terminal
   * mapping would turn a leading escape into an Alt chord.
   * @param notation - the keys, in `nvim_input` notation.
   */
  inputNotation(notation: string): void {
    if (this.disposed || notation === '') return
    this.request('nvim_input', [notation])
  }

  /** Send one request and ignore its response. */
  private request(method: string, params: Msgpack[]): void {
    this.nextRequest += 1
    this.options.channel.send(encodeMsgpack([0, this.nextRequest, method, params]))
  }

  /**
   * Stop feeding this grid and end the channel.
   *
   * Closing the socket is what ends Neovim: the process belongs to the Host and
   * lives exactly as long as its column, so a disposed pane must not leave a
   * channel behind.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.options.channel.close()
  }
}

/**
 * Translate one SGR mouse report into `nvim_input_mouse` parameters.
 *
 * The report carries a button byte with modifier and motion bits, and one-based
 * coordinates local to the pane; Neovim wants a button name, an action, a
 * modifier string and zero-based grid coordinates.
 * @param code - the SGR button byte.
 * @param x - one-based column.
 * @param y - one-based row.
 * @param pressed - true for `M` (press or motion), false for `m` (release).
 * @returns the call parameters, or undefined when the report is not one Neovim takes.
 */
export function mouseRequest(code: number, x: number, y: number, pressed: boolean): Msgpack[] | undefined {
  const modifiers = `${(code & 4) !== 0 ? 'S' : ''}${(code & 16) !== 0 ? 'C' : ''}${(code & 8) !== 0 ? 'A' : ''}`
  const wheel = (code & 64) !== 0
  if (wheel) {
    if (!pressed) return undefined
    return ['wheel', (code & 1) === 0 ? 'up' : 'down', modifiers, 0, y - 1, x - 1]
  }
  const button = (code & 3) === 0 ? 'left' : (code & 3) === 1 ? 'middle' : (code & 3) === 2 ? 'right' : 'move'
  const action = !pressed ? 'release' : (code & 32) !== 0 ? 'drag' : 'press'
  return [button, action, modifiers, 0, y - 1, x - 1]
}

/**
 * Neovim's UI mode name as the single-letter mode the rest of the client knows.
 *
 * The UI protocol names modes (`normal`, `insert`, …) while the editor's old
 * marker file carried `vim.v.event.new_mode` letters, and the input-source and
 * escape rules are written against those letters. One translation here keeps
 * both readers — and their tests — untouched.
 * @param mode - the name from `mode_change`.
 * @returns the letter, or the name itself when it has no single-letter form.
 */
export function modeLetter(mode: string): string {
  switch (mode) {
    case 'normal':
    case 'cmdline_normal':
    case 'showmatch':
    case 'more':
    case 'operator':
    case 'confirm':
      return 'n'
    case 'insert':
    case 'cmdline_insert':
      return 'i'
    case 'replace':
      return 'R'
    case 'visual':
      return 'v'
    case 'visual_line':
      return 'V'
    case 'visual_block':
      return '\u0016'
    default:
      return mode
  }
}

/**
 * Terminal bytes as Neovim key notation.
 *
 * Re-exported from the input decoder so the column and the pty branch read the
 * same vocabulary: there is one answer to "what did the user press".
 */
export { keyNotation }

