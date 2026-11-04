/**
 * libghostty-vt in a WebAssembly module: the terminal state behind both columns.
 *
 * Ghostty's terminal emulator ships as one `ghostty-vt.wasm`
 * (`zig build -Demit-lib-vt -Dtarget=wasm32-freestanding`), so the column needs
 * no native module and no per-platform binary. This module is the only place
 * that speaks its C ABI; everything above it works with rendered rows and a
 * cursor position.
 *
 * Three things shape the implementation:
 *
 * - Struct offsets and enum values come from the module's own
 *   `ghostty_type_json()` at load time. The published ABI is still moving, so a
 *   hard-coded layout would turn a version bump into a silent memory bug.
 * - Reads go through the render state, the documented read path for renderers:
 *   it is viewport-relative (so history paging shows the scrolled rows), reports
 *   the cursor, and resolves palette colours against the terminal's palette.
 * - Wasm linear memory grows as the terminal allocates, so no typed array is
 *   kept across calls; every access re-acquires `memory.buffer`.
 *
 * @module hulala-cli/tui/pane/ghosttyVt
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

/** Cursor placement inside the visible viewport. */
export interface VtCursor {
  readonly visible: boolean
  readonly x: number
  readonly y: number
}

/** Scrollable area and where the viewport sits inside it. */
export interface VtScrollbar {
  readonly total: number
  readonly offset: number
  readonly length: number
}

/** RGB colour from the terminal palette. */
export interface VtRgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** Draws the block under the program cursor; the caller owns the styling. */
export interface CursorInk {
  /** Characters and the cell's SGR parameters (no leading escape). */
  draw(text: string, sgr: string): string
}

/** Field metadata from `ghostty_type_json()`. */
interface Field {
  readonly offset: number
  readonly size: number
  readonly type: string
}

/** Struct metadata from `ghostty_type_json()`. */
interface StructType {
  readonly size: number
  readonly fields: Record<string, Field>
  readonly values?: Record<string, number>
}

/** The subset of the type layout this module reads. */
interface TypeLayout {
  readonly abi: { readonly usize_size: number; readonly pointer_size: number }
  readonly types: Record<string, StructType>
}

/** Where the module may live, relative to a package root. */
const WASM_CANDIDATES = ['vendor/ghostty-vt.wasm', 'runtime/ghostty-vt.wasm']

/** How far up from this file the package root may be. */
const ROOT_SEARCH_DEPTH = 6

/** Calls per frame that touch the terminal, so the buffers never thrash. */
const RESET = '\u001b[0m'

/** Locate the module: explicit override, then the package root, then upward. */
function locateWasm(): string {
  const explicit = process.env.HULALA_VT_WASM?.trim()
  if (explicit !== undefined && explicit !== '') return resolve(explicit)
  const roots: string[] = []
  const packageRoot = process.env.HULALA_PACKAGE_ROOT?.trim()
  if (packageRoot !== undefined && packageRoot !== '') roots.push(packageRoot)
  let directory = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < ROOT_SEARCH_DEPTH; depth += 1) {
    roots.push(directory)
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  for (const root of roots) {
    for (const candidate of WASM_CANDIDATES) {
      const path = join(root, candidate)
      if (existsSync(path)) return path
    }
  }
  throw new Error(`ghostty-vt.wasm not found beside ${fileURLToPath(import.meta.url)}`)
}

/** The exports this module calls, named as the C API names them. */
interface Exports {
  readonly memory: WebAssembly.Memory
  ghostty_type_json(): number
  ghostty_wasm_alloc(size: number): number
  ghostty_wasm_free(pointer: number, size: number): void
  ghostty_wasm_alloc_opaque(): number
  ghostty_wasm_take_opaque(slot: number): number
  ghostty_wasm_free_opaque(slot: number): void
  ghostty_free(allocator: number, pointer: number, size: number): void
  ghostty_terminal_new(allocator: number, out: number, cols: number, rows: number): number
  ghostty_terminal_free(terminal: number): void
  ghostty_terminal_resize(terminal: number, cols: number, rows: number, cellWidth: number, cellHeight: number): number
  ghostty_terminal_vt_write(terminal: number, data: number, length: number): void
  ghostty_terminal_get(terminal: number, data: number, out: number): number
  ghostty_terminal_scroll_viewport(terminal: number, behavior: number): void
  ghostty_render_state_new(allocator: number, out: number): number
  ghostty_render_state_free(state: number): void
  ghostty_render_state_update(state: number, terminal: number): number
  ghostty_render_state_clean(state: number): number
  ghostty_render_state_get(state: number, data: number, out: number): number
  ghostty_render_state_row_iterator_new(allocator: number, out: number): number
  ghostty_render_state_row_iterator_free(iterator: number): void
  ghostty_render_state_row_iterator_next(iterator: number, out: number): boolean
  ghostty_render_state_row_get(iterator: number, data: number, out: number): number
  ghostty_render_state_row_cells_new(allocator: number, out: number): number
  ghostty_render_state_row_cells_free(cells: number): void
  ghostty_render_state_row_cells_next(cells: number): boolean
  ghostty_render_state_row_cells_get(cells: number, data: number, out: number): number
}

let compiled: { readonly module: WebAssembly.Module; readonly layout: TypeLayout } | undefined

/** Compile the module and read its type layout once per process. */
function load(): { module: WebAssembly.Module; layout: TypeLayout } {
  if (compiled !== undefined) return compiled
  const module = new WebAssembly.Module(readFileSync(locateWasm()))
  const imports: WebAssembly.Imports = {}
  for (const entry of WebAssembly.Module.imports(module)) {
    const target = (imports[entry.module] ??= {}) as Record<string, unknown>
    target[entry.name] = (): void => undefined
  }
  const exports = new WebAssembly.Instance(module, imports).exports as unknown as Exports
  const pointer = exports.ghostty_type_json()
  const bytes = new Uint8Array(exports.memory.buffer, pointer)
  const json = new TextDecoder().decode(bytes).split('\u0000')[0] as string
  compiled = { module, layout: JSON.parse(json) as TypeLayout }
  return compiled
}

/** One colour as SGR, or `''` when the cell keeps the terminal default. */
function colorSgr(prefix: 38 | 48, tag: number, index: number, rgb: VtRgb, tags: Record<string, number>): string {
  if (tag === (tags.PALETTE ?? 1)) return `;${prefix};5;${index}`
  if (tag === (tags.RGB ?? 2)) return `;${prefix};2;${rgb.r};${rgb.g};${rgb.b}`
  return ''
}

/** Pad or truncate one rendered row to exactly `width` visible cells. */
function fit(line: string, width: number): string {
  const current = visibleWidth(line)
  if (current === width) return line
  if (current > width) return truncateToWidth(line, width, '')
  return line + ' '.repeat(width - current)
}

/** One program's screen model, driven byte for byte. */
export class GhosttyVt {
  private readonly exports: Exports
  private readonly terminal: number
  private readonly renderState: number
  private readonly rowIterator: number
  private readonly cells: number
  private readonly cursorBuffer: number
  private readonly colorsBuffer: number
  private readonly scrollbarBuffer: number
  private readonly behaviorBuffer: number
  private readonly styleBuffer: number
  private readonly codepointsBuffer: number
  private readonly slot: number
  private readonly tags: {
    readonly color: Record<string, number>
    readonly row: Record<string, number>
    readonly cell: Record<string, number>
    readonly render: Record<string, number>
    readonly terminal: Record<string, number>
    readonly scroll: Record<string, number>
  }
  private readonly sizes: {
    readonly cursor: number
    readonly colors: number
    readonly scrollbar: number
    readonly behavior: number
    readonly style: number
  }
  private readonly offsets: {
    readonly style: Record<string, Field>
    readonly styleColor: Record<string, Field>
    readonly colors: Record<string, Field>
    readonly cursor: Record<string, Field>
    readonly scrollbar: Record<string, Field>
    readonly behavior: Record<string, Field>
  }
  /** Pointer width of the runtime, so an opaque handle reads the same on both. */
  private readonly pointerSize: number
  private disposed = false
  private columnCount: number
  private lineCount: number

  constructor(cols: number, rows: number) {
    const { module, layout } = load()
    const imports: WebAssembly.Imports = {}
    for (const entry of WebAssembly.Module.imports(module)) {
      const target = (imports[entry.module] ??= {}) as Record<string, unknown>
      target[entry.name] = (): void => undefined
    }
    this.exports = new WebAssembly.Instance(module, imports).exports as unknown as Exports
    const type = (name: string): StructType => layout.types[name] as StructType
    const values = (name: string): Record<string, number> => type(name).values ?? {}
    this.tags = {
      color: values('GhosttyStyleColorTag'),
      row: values('GhosttyRenderStateRowData'),
      cell: values('GhosttyRenderStateRowCellsData'),
      render: values('GhosttyRenderStateData'),
      terminal: values('GhosttyTerminalData'),
      scroll: values('GhosttyTerminalScrollViewportTag'),
    }
    this.sizes = {
      cursor: type('GhosttyRenderStateCursor').size,
      colors: type('GhosttyRenderStateColors').size,
      scrollbar: type('GhosttyTerminalScrollbar').size,
      behavior: type('GhosttyTerminalScrollViewport').size,
      style: type('GhosttyStyle').size,
    }
    this.offsets = {
      style: type('GhosttyStyle').fields,
      styleColor: type('GhosttyStyleColor').fields,
      colors: type('GhosttyRenderStateColors').fields,
      cursor: type('GhosttyRenderStateCursor').fields,
      scrollbar: type('GhosttyTerminalScrollbar').fields,
      behavior: type('GhosttyTerminalScrollViewport').fields,
    }
    this.pointerSize = layout.abi.pointer_size
    const ex = this.exports
    // Sized structs carry their own size and every read validates it.
    const sizes = (pointer: number, size: number): number => {
      new DataView(ex.memory.buffer).setUint32(pointer, size, true)
      return pointer
    }
    this.cursorBuffer = sizes(ex.ghostty_wasm_alloc(this.sizes.cursor), this.sizes.cursor)
    this.colorsBuffer = sizes(ex.ghostty_wasm_alloc(this.sizes.colors), this.sizes.colors)
    this.scrollbarBuffer = ex.ghostty_wasm_alloc(this.sizes.scrollbar)
    this.behaviorBuffer = ex.ghostty_wasm_alloc(this.sizes.behavior)
    this.styleBuffer = sizes(ex.ghostty_wasm_alloc(this.sizes.style), this.sizes.style)
    this.codepointsBuffer = ex.ghostty_wasm_alloc(16 * 4)
    this.slot = ex.ghostty_wasm_alloc_opaque()
    ex.ghostty_terminal_new(0, this.slot, cols, rows)
    this.terminal = this.handle()
    ex.ghostty_render_state_new(0, this.slot)
    this.renderState = this.handle()
    ex.ghostty_render_state_row_iterator_new(0, this.slot)
    this.rowIterator = this.handle()
    ex.ghostty_render_state_row_cells_new(0, this.slot)
    this.cells = this.handle()
    this.columnCount = cols
    this.lineCount = rows
  }

  /** Current grid width in cells. */
  get columns(): number {
    return this.columnCount
  }

  /** Current grid height in rows. */
  get rows(): number {
    return this.lineCount
  }

  /** Read the pointer-sized handle written into the opaque slot. */
  private handle(): number {
    const view = new DataView(this.exports.memory.buffer)
    return this.pointerSize === 4 ? view.getUint32(this.slot, true) : Number(view.getBigUint64(this.slot, true))
  }

  /** Write a handle back into the slot, the way C passes `&handle`. */
  private setHandle(value: number): void {
    const view = new DataView(this.exports.memory.buffer)
    if (this.pointerSize === 4) view.setUint32(this.slot, value, true)
    else view.setBigUint64(this.slot, BigInt(value), true)
  }

  /** Feed one chunk of the program's output. */
  write(data: Uint8Array): void {
    if (this.disposed || data.length === 0) return
    const ex = this.exports
    const pointer = ex.ghostty_wasm_alloc(data.length)
    new Uint8Array(ex.memory.buffer, pointer, data.length).set(data)
    ex.ghostty_terminal_vt_write(this.terminal, pointer, data.length)
    ex.ghostty_wasm_free(pointer, data.length)
  }

  /** Resize the screen model; the caller resizes the pty alongside it. */
  resize(cols: number, rows: number): void {
    if (this.disposed) return
    if (cols === this.columnCount && rows === this.lineCount) return
    this.exports.ghostty_terminal_resize(this.terminal, cols, rows, 0, 0)
    this.columnCount = cols
    this.lineCount = rows
  }

  /** Whether the program painted the alternate screen, i.e. owns `Esc`. */
  alternateScreen(): boolean {
    if (this.disposed) return false
    this.exports.ghostty_terminal_get(this.terminal, this.tags.terminal.ACTIVE_SCREEN ?? 6, this.slot)
    return new DataView(this.exports.memory.buffer).getUint32(this.slot, true) === 1
  }

  /** Cursor placement inside the viewport, as the program last left it. */
  cursor(): VtCursor {
    if (this.disposed) return { visible: false, x: 0, y: 0 }
    const ex = this.exports
    ex.ghostty_render_state_update(this.renderState, this.terminal)
    ex.ghostty_render_state_get(this.renderState, this.tags.render.CURSOR ?? 18, this.cursorBuffer)
    const view = new DataView(ex.memory.buffer)
    const fields = this.offsets.cursor
    const hasValue = view.getUint8(this.cursorBuffer + (fields.viewport_has_value?.offset ?? 4)) !== 0
    return {
      // A program that hides the cursor (DEC 25) still has a cursor cell; the
      // pane has always drawn it, so `visible` reports the cell's existence.
      visible: hasValue,
      x: view.getUint16(this.cursorBuffer + (fields.viewport_x?.offset ?? 6), true),
      y: view.getUint16(this.cursorBuffer + (fields.viewport_y?.offset ?? 8), true),
    }
  }

  /** The terminal's effective background colour, or undefined when unset. */
  background(): VtRgb | undefined {
    if (this.disposed) return undefined
    const ex = this.exports
    const result = ex.ghostty_terminal_get(this.terminal, this.tags.terminal.COLOR_BACKGROUND ?? 19, this.colorsBuffer)
    if (result !== 0) return undefined
    const view = new DataView(ex.memory.buffer)
    return { r: view.getUint8(this.colorsBuffer), g: view.getUint8(this.colorsBuffer + 1), b: view.getUint8(this.colorsBuffer + 2) }
  }

  /** SGR background matching the terminal, or `''` for the default surface. */
  backgroundAnsi(): string {
    const rgb = this.background()
    return rgb === undefined ? '' : `\u001b[48;2;${rgb.r};${rgb.g};${rgb.b}m`
  }

  /** Scrollable area and the viewport's position inside it. */
  scrollbar(): VtScrollbar {
    if (this.disposed) return { total: 0, offset: 0, length: 0 }
    const ex = this.exports
    ex.ghostty_terminal_get(this.terminal, this.tags.terminal.SCROLLBAR ?? 9, this.scrollbarBuffer)
    const view = new DataView(ex.memory.buffer)
    const fields = this.offsets.scrollbar
    const read = (name: 'total' | 'offset' | 'len'): number => {
      const at = this.scrollbarBuffer + (fields[name]?.offset ?? 0)
      return Number(view.getBigUint64(at, true))
    }
    return { total: read('total'), offset: read('offset'), length: read('len') }
  }

  /** Rows above the live screen that the viewport is showing. */
  scrolledBack(): number {
    const bar = this.scrollbar()
    return Math.max(0, bar.total - bar.length - bar.offset)
  }

  /** Move the viewport by whole rows; negative scrolls back. */
  scrollDelta(rows: number): void {
    if (this.disposed || rows === 0) return
    const view = new DataView(this.exports.memory.buffer)
    view.setInt32(this.behaviorBuffer + (this.offsets.behavior.tag?.offset ?? 0), this.tags.scroll.DELTA ?? 2, true)
    view.setInt32(this.behaviorBuffer + (this.offsets.behavior.value?.offset ?? 8), rows, true)
    this.exports.ghostty_terminal_scroll_viewport(this.terminal, this.behaviorBuffer)
  }

  /** Return the viewport to the live screen. */
  scrollToBottom(): void {
    if (this.disposed) return
    const view = new DataView(this.exports.memory.buffer)
    view.setInt32(this.behaviorBuffer + (this.offsets.behavior.tag?.offset ?? 0), this.tags.scroll.BOTTOM ?? 1, true)
    this.exports.ghostty_terminal_scroll_viewport(this.terminal, this.behaviorBuffer)
  }

  /**
   * The visible viewport, one styled line per row.
   *
   * Cells are emitted with their resolved colours (palette indices stay
   * indices), wide glyphs claim both of their columns, and the cell under the
   * cursor is handed to `ink` so the caller can draw its own cursor block.
   * @param cols - column count the rows are flushed to.
   * @param rows - row count to return; missing rows come back blank.
   * @param cursor - where to draw the program cursor, if anywhere.
   * @param ink - draws the cursor cell.
   * @returns exactly `rows` lines, each `cols` visible cells wide.
   */
  renderRows(cols: number, rows: number, cursor: VtCursor | undefined, ink: CursorInk | undefined): string[] {
    if (this.disposed) return Array.from({ length: rows }, () => ' '.repeat(cols))
    const ex = this.exports
    ex.ghostty_render_state_update(this.renderState, this.terminal)
    this.setHandle(this.rowIterator)
    ex.ghostty_render_state_get(this.renderState, this.tags.render.ROW_ITERATOR ?? 4, this.slot)
    // The state hands back the iterator it has bound to itself, which is what the
    // per-row calls belong to; the handle created above only seeds that slot.
    const iterator = this.handle()
    const lines: string[] = []
    let rowIndex = 0
    while (rowIndex < rows && ex.ghostty_render_state_row_iterator_next(iterator, this.slot)) {
      this.setHandle(this.cells)
      ex.ghostty_render_state_row_get(iterator, this.tags.row.CELLS ?? 3, this.slot)
      const cells = this.handle()
      let out = ''
      let open = ''
      let column = 0
      let pendingWide = false
      while (column < cols && ex.ghostty_render_state_row_cells_next(cells)) {
        const cell = this.cell(cells)
        if (cell.text === '') {
          // The tail of a wide glyph is its own cell and must not add a column.
          if (pendingWide) {
            pendingWide = false
            continue
          }
          if (cursor !== undefined && cursor.visible && cursor.y === rowIndex && cursor.x === column && ink !== undefined) {
            out += ink.draw(' ', '')
            open = ''
            column += 1
            continue
          }
          if (open !== '') {
            out += RESET
            open = ''
          }
          out += ' '
          column += 1
          continue
        }
        if (cursor !== undefined && cursor.visible && cursor.y === rowIndex && cursor.x === column && ink !== undefined) {
          out += ink.draw(cell.text, cell.sgr)
          open = ''
        } else if (cell.sgr !== open) {
          out += RESET + (cell.sgr === '' ? '' : `\u001b[${cell.sgr.slice(1)}m`)
          open = cell.sgr
          out += cell.text
        } else {
          out += cell.text
        }
        const width = visibleWidth(cell.text)
        column += Math.max(1, width)
        pendingWide = width > 1
      }
      out += RESET
      lines.push(fit(out, cols))
      rowIndex += 1
    }
    ex.ghostty_render_state_clean(this.renderState)
    while (lines.length < rows) lines.push(' '.repeat(cols))
    return lines
  }

  /** Read the cell the row iterator points at. */
  private cell(cells: number): { readonly text: string; readonly sgr: string } {
    const ex = this.exports
    const data = this.tags.cell
    ex.ghostty_render_state_row_cells_get(cells, data.GRAPHEMES_LEN ?? 3, this.slot)
    const length = new DataView(ex.memory.buffer).getUint32(this.slot, true)
    if (length === 0) return { text: '', sgr: '' }
    ex.ghostty_render_state_row_cells_get(cells, data.GRAPHEMES_BUF ?? 4, this.codepointsBuffer)
    const count = Math.min(length, 16)
    const codepoints = new Uint32Array(ex.memory.buffer, this.codepointsBuffer, count)
    const text = String.fromCodePoint(...codepoints)
    new DataView(ex.memory.buffer).setUint32(this.styleBuffer, this.sizes.style, true)
    ex.ghostty_render_state_row_cells_get(cells, data.STYLE ?? 2, this.styleBuffer)
    return { text, sgr: this.styleSgr() }
  }

  /** SGR parameters for the style written into `styleBuffer`. */
  private styleSgr(): string {
    const view = new DataView(this.exports.memory.buffer)
    const fields = this.offsets.style
    const base = this.styleBuffer
    const color = (name: 'fg_color' | 'bg_color'): string => {
      const at = base + (fields[name]?.offset ?? 0)
      const tag = view.getInt32(at + (this.offsets.styleColor.tag?.offset ?? 0), true)
      const value = at + (this.offsets.styleColor.value?.offset ?? 8)
      const index = view.getUint8(value)
      const rgb = { r: view.getUint8(value), g: view.getUint8(value + 1), b: view.getUint8(value + 2) }
      return colorSgr(name === 'fg_color' ? 38 : 48, tag, index, rgb, this.tags.color)
    }
    const flag = (name: string): boolean => view.getUint8(base + (fields[name]?.offset ?? 0)) !== 0
    let sgr = ''
    if (flag('bold')) sgr += ';1'
    if (flag('faint')) sgr += ';2'
    if (flag('italic')) sgr += ';3'
    if (view.getInt32(base + (fields.underline?.offset ?? 64), true) !== 0) sgr += ';4'
    if (flag('blink')) sgr += ';5'
    if (flag('inverse')) sgr += ';7'
    if (flag('invisible')) sgr += ';8'
    if (flag('strikethrough')) sgr += ';9'
    if (flag('overline')) sgr += ';53'
    return sgr + color('fg_color') + color('bg_color')
  }

  /** Release every handle and scratch buffer this instance owns. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const ex = this.exports
    ex.ghostty_render_state_row_cells_free(this.cells)
    ex.ghostty_render_state_row_iterator_free(this.rowIterator)
    ex.ghostty_render_state_free(this.renderState)
    ex.ghostty_terminal_free(this.terminal)
    ex.ghostty_wasm_free(this.cursorBuffer, this.sizes.cursor)
    ex.ghostty_wasm_free(this.colorsBuffer, this.sizes.colors)
    ex.ghostty_wasm_free(this.scrollbarBuffer, this.sizes.scrollbar)
    ex.ghostty_wasm_free(this.behaviorBuffer, this.sizes.behavior)
    ex.ghostty_wasm_free(this.styleBuffer, this.sizes.style)
    ex.ghostty_wasm_free(this.codepointsBuffer, 16 * 4)
    ex.ghostty_wasm_free_opaque(this.slot)
  }
}
