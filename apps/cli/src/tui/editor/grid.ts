/**
 * The cell grid a Neovim UI draws, with the protocol's own semantics.
 *
 * This is the one place that knows what a `grid_line` or a `grid_scroll` means.
 * It is written against Nvim's `api-ui-events.txt` rather than against what a
 * particular screen happened to look like, because every rendering bug in a UI
 * client comes from one of these four facts being re-decided somewhere else:
 *
 * - a cell's `text` may be **wide** (two columns) or **empty** (the right half
 *   of a wide character), and both are written verbatim;
 * - `repeat` copies the cell's own text — it is not a run of blanks;
 * - a scroll moves `[top, bottom) × [left, right)` by `rows`/`cols` and leaves
 *   the vacated rows blank, and nvim refills them with `grid_line` right after;
 * - a row carries `wrap` when it continues onto the next one.
 *
 * @module hulala-cli/tui/editor/grid
 */

/** One cell: what to draw and which attribute id paints it. */
export interface Cell {
  /**
   * The cell's text.
   *
   * `' '` is an empty cell, one character is a normal cell, `''` is the right
   * half of the wide character before it, and a longer string is a wide
   * grapheme cluster — all of them are drawn as they are.
   */
  text: string
  /** Attribute id from `hl_attr_define`; `0` is the default group. */
  hl: number
}

/** One row of cells and whether it continues on the next row. */
export interface GridRow {
  readonly cells: Cell[]
  /** `grid_line`'s `wrap`: this line wraps onto the row below. */
  wrap: boolean
}

/** Cells that fill a line's remainder, as Nvim sends them. */
export function blankCell(): Cell {
  return { text: ' ', hl: 0 }
}

/**
 * The screen grid.
 *
 * Deliberately a value, not a view: it holds no cursor, no focus and no theme,
 * so a test can compare cells and a renderer can paint them without either one
 * having to agree with the other about anything but this structure.
 */
export class Grid {
  private rows: GridRow[]
  private cols: number

  constructor(cols: number, rows: number) {
    this.cols = Math.max(0, cols)
    this.rows = Array.from({ length: Math.max(0, rows) }, () => this.blankRow(this.cols))
  }

  /** How many rows the grid has. */
  get height(): number {
    return this.rows.length
  }

  /** How many columns each row has. */
  get width(): number {
    return this.cols
  }

  private blankRow(cols: number): GridRow {
    return { cells: Array.from({ length: cols }, blankCell), wrap: false }
  }

  /** One row, or undefined outside the grid. */
  row(index: number): GridRow | undefined {
    return this.rows[index]
  }

  /** One cell, or undefined outside the grid. */
  cell(row: number, col: number): Cell | undefined {
    return this.rows[row]?.cells[col]
  }

  /** One row's text as it would appear on screen, wide cells included. */
  text(row: number): string {
    return (this.rows[row]?.cells ?? []).map(cell => cell.text).join('')
  }

  /**
   * Reshape the grid, keeping the cells that still fit.
   *
   * A UI resizes its grid as soon as the pane changes size, and Neovim answers
   * with a fresh `grid_resize` and a full repaint; keeping the overlapping cells
   * means the frame in between shows the old screen rather than a blank column.
   * @param cols - new width in cells.
   * @param rows - new height in rows.
   */
  resize(cols: number, rows: number): void {
    const width = Math.max(0, cols)
    const height = Math.max(0, rows)
    const next: GridRow[] = []
    for (let row = 0; row < height; row += 1) {
      const existing = this.rows[row]
      const line = this.blankRow(width)
      for (let col = 0; col < width; col += 1) {
        const cell = existing?.cells[col]
        if (cell !== undefined) line.cells[col] = { text: cell.text, hl: cell.hl }
      }
      next.push({ cells: line.cells, wrap: existing?.wrap ?? false })
    }
    this.cols = width
    this.rows = next
  }

  /**
   * Replace the grid with an empty one of the given size.
   *
   * This is `grid_resize`, which Nvim always follows with a full repaint: the
   * old cells are not part of the new screen, so keeping them would only show
   * stale text for the frame between the two events.
   * @param cols - new width in cells.
   * @param rows - new height in rows.
   */
  reset(cols: number, rows: number): void {
    this.cols = Math.max(0, cols)
    this.rows = Array.from({ length: Math.max(0, rows) }, () => this.blankRow(this.cols))
  }

  /** Blank every cell, keeping the size. */
  clear(): void {
    for (let row = 0; row < this.rows.length; row += 1) {
      this.rows[row] = this.blankRow(this.cols)
    }
  }

  /**
   * Apply one `grid_line`.
   *
   * `cells` is `[text(, hl_id, repeat)]`, where a missing `hl_id` inherits the
   * last one **within this call** (it is always sent for the first cell), and
   * `repeat` includes the first copy. A double-width character's right half is
   * the empty string, and never repeated.
   * @param row - the row to redraw.
   * @param col - the first column to redraw.
   * @param cells - the cell groups, as Nvim sends them.
   * @param wrap - whether this row continues onto the next.
   */
  line(row: number, col: number, cells: readonly (readonly (string | number)[])[], wrap = false): void {
    const target = this.rows[row]
    if (target === undefined) return
    target.wrap = wrap
    let hl = 0
    let at = col
    for (const cell of cells) {
      const text = typeof cell[0] === 'string' ? cell[0] : ' '
      const own = typeof cell[1] === 'number' ? cell[1] : undefined
      if (own !== undefined) hl = own
      const rawRepeat = typeof cell[2] === 'number' ? cell[2] : 1
      const repeat = Math.max(1, Math.trunc(rawRepeat))
      for (let index = 0; index < repeat; index += 1) {
        const slot = target.cells[at]
        if (slot !== undefined) {
          // Every copy is the cell's own text: a run of `─` is a rule, not one
          // dash followed by blanks.
          slot.text = text
          slot.hl = hl
        }
        at += 1
      }
    }
  }

  /**
   * Apply one `grid_scroll`.
   *
   * The region is `[top, bottom) × [left, right)`; with `rows > 0` the content
   * moves up (destination rows are `[top, bottom - rows)`) and with `rows < 0`
   * it moves down. The rows the content left behind are blanked here, the way
   * Nvim's own reference UI does it, even though the next `grid_line` fills them
   * again — a grid that depended on that would render stale text in between.
   *
   * `cols` is always zero in this Nvim, and kept for the protocol's sake.
   * @param top - first row of the region.
   * @param bottom - one past the last row of the region.
   * @param left - first column of the region.
   * @param right - one past the last column of the region.
   * @param rows - rows to move; positive moves content up.
   * @param cols - columns to move; positive moves content left.
   */
  scroll(top: number, bottom: number, left: number, right: number, rows: number, cols: number): void {
    const height = bottom - top
    const width = right - left
    if (height <= 0 || width <= 0) return
    if (rows === 0 && cols === 0) return
    // A snapshot, because a cell's new value depends on a cell this loop may
    // already have written — destination and source share a region by design.
    const source = this.rows.map(row => row.cells.map(cell => ({ text: cell.text, hl: cell.hl })))
    // Content moves by `rows`/`cols`: positive moves it up and to the left, so a
    // destination cell takes its content from `rows`/`cols` further on.
    const inside = (row: number, col: number): boolean =>
      row >= top && row < bottom && col >= left && col < right
    // The destination rectangle: the part of the region the content moves into.
    const firstRow = rows > 0 ? top : Math.max(top, top - rows)
    const lastRow = rows > 0 ? Math.min(bottom, bottom - rows) : bottom
    for (let row = firstRow; row < lastRow; row += 1) {
      for (let col = left; col < right; col += 1) {
        const target = this.rows[row]?.cells[col]
        if (target === undefined) continue
        const from = inside(row + rows, col + cols) ? source[row + rows]?.[col + cols] : undefined
        target.text = from?.text ?? ' '
        target.hl = from?.hl ?? 0
      }
    }
    // The rectangle the content left behind, which nvim refills with grid_line.
    for (let row = top; row < firstRow; row += 1) this.clearRowPart(row, left, right)
    for (let row = lastRow; row < bottom; row += 1) this.clearRowPart(row, left, right)
  }

  private clearRowPart(row: number, left: number, right: number): void {
    const line = this.rows[row]
    if (line === undefined) return
    for (let col = left; col < right; col += 1) {
      const cell = line.cells[col]
      if (cell === undefined) continue
      cell.text = ' '
      cell.hl = 0
    }
  }
}
