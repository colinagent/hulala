/**
 * The grid model, against the protocol rather than against a screenshot.
 *
 * Each case names the fact it pins, taken from Nvim's `api-ui-events.txt` and
 * its own reference UI (`test/functional/ui/screen.lua`). A rendering bug in a
 * UI client is almost always one of these facts being decided differently here
 * and somewhere else — `repeat` read as a run of blanks, a scroll copied the
 * wrong way, a wide character's right half turned into a space.
 */
import { expect, test } from 'bun:test'
import { Grid } from '../../src/tui/editor/grid.ts'

/** A grid filled with one character per cell, row by row. */
function filled(cols: number, rows: number, text: string[]): Grid {
  const grid = new Grid(cols, rows)
  for (let row = 0; row < rows; row += 1) {
    grid.line(row, 0, [...(text[row] ?? '').padEnd(cols, ' ')].map(character => [character]))
  }
  return grid
}

test('repeat copies the cell text, not blanks', () => {
  // Nvim sends a rule as `["─", hl, 10]`; writing one dash and nine spaces is
  // what a frame of a status line looked like before this was pinned.
  const grid = new Grid(12, 1)
  grid.line(0, 1, [['─', 3, 10]])
  expect(grid.text(0)).toBe(' ────────── ')
  expect(grid.cell(0, 1)?.hl).toBe(3)
  expect(grid.cell(0, 10)?.hl).toBe(3)
})

test('a missing hl_id inherits the last one in the call', () => {
  const grid = new Grid(4, 1)
  grid.line(0, 0, [['a', 7], ['b'], ['c', 9], ['d']])
  expect([0, 1, 2, 3].map(col => grid.cell(0, col)?.hl)).toEqual([7, 7, 9, 9])
})

test("a wide character's right half is an empty cell, drawn verbatim", () => {
  const grid = new Grid(4, 1)
  // Four columns: the pair covers two of them.
  grid.line(0, 0, [['中', 1], [''], ['x'], [' ']])
  expect(grid.text(0)).toBe('中x ')
  // The pair covers two columns; the empty text is the second half.
  expect(grid.cell(0, 1)?.text).toBe('')
})

test('grid_scroll with rows > 0 moves the content up and blanks the row it left', () => {
  const grid = filled(3, 3, ['abc', 'def', 'ghi'])
  grid.scroll(0, 3, 0, 3, 1, 0)
  expect([0, 1, 2].map(row => grid.text(row))).toEqual(['def', 'ghi', '   '])
})

test('grid_scroll with rows < 0 moves the content down', () => {
  const grid = filled(3, 3, ['abc', 'def', 'ghi'])
  grid.scroll(0, 3, 0, 3, -1, 0)
  expect([0, 1, 2].map(row => grid.text(row))).toEqual(['   ', 'abc', 'def'])
})

test('grid_scroll leaves rows outside the region alone, however far it moves', () => {
  // A region of rows [1,3) scrolled by one: row 0 and the row below the region
  // keep their cells, which is what a split window's status line looks like.
  const grid = filled(2, 4, ['aa', 'bb', 'cc', 'dd'])
  grid.scroll(1, 3, 0, 2, 1, 0)
  expect([0, 1, 2, 3].map(row => grid.text(row))).toEqual(['aa', 'cc', '  ', 'dd'])
})

test('grid_scroll by more than the region clears all of it', () => {
  const grid = filled(2, 3, ['aa', 'bb', 'cc'])
  grid.scroll(0, 3, 0, 2, 5, 0)
  expect([0, 1, 2].map(row => grid.text(row))).toEqual(['  ', '  ', '  '])
})

test('grid_scroll with cols > 0 moves the content left inside the region only', () => {
  const grid = filled(4, 1, ['abcd'])
  grid.scroll(0, 1, 1, 4, 0, 1)
  expect(grid.text(0)).toBe('acd ')
})

test('grid_resize replaces the screen, and our own resize keeps the overlap', () => {
  const grid = filled(3, 2, ['abc', 'def'])
  // `grid_resize` is followed by a full repaint, so the old cells are not part
  // of the new screen; our own pane resize happens before that repaint arrives.
  grid.reset(2, 1)
  expect(grid.text(0)).toBe('  ')
  const kept = filled(3, 2, ['abc', 'def'])
  kept.resize(2, 2)
  expect([0, 1].map(row => kept.text(row))).toEqual(['ab', 'de'])
})

test('wrap is recorded per row', () => {
  const grid = new Grid(2, 2)
  grid.line(0, 0, [['a'], ['b']], true)
  grid.line(1, 0, [['c'], ['d']])
  expect(grid.row(0)?.wrap).toBe(true)
  expect(grid.row(1)?.wrap).toBe(false)
})
