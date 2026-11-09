import { expect, test } from 'bun:test'
import { GhosttyVt } from '../../src/tui/pane/ghosttyVt.js'

const encoder = new TextEncoder()

function paint(vt: GhosttyVt, text: string): void {
  vt.write(encoder.encode(text))
}

/** The row as the pane draws it: one SGR run per style. */
function row(vt: GhosttyVt, width: number): string {
  return vt.renderRows(width, 1, undefined, undefined)[0] ?? ''
}

test('erasing to the end of a line keeps the background it was painted with', () => {
  const vt = new GhosttyVt(12, 2)
  // What Neovim does for a floating window's row: set the pen to the panel's
  // background, then clear the rest of the line. A terminal fills those cells
  // with that background; this module's build cleared them to the default.
  paint(vt, '\u001b[48;2;57;61;68m\u001b[K')
  expect(row(vt, 12)).toBe('\u001b[0m\u001b[48;2;57;61;68m            \u001b[0m')
})

test('erased characters keep the pen and leave the cursor where it was', () => {
  const vt = new GhosttyVt(12, 2)
  paint(vt, '\u001b[48;2;10;20;30m\u001b[3X')
  // The erase covers three cells at the cursor. Writing after it must land on
  // the same cell the erase started at, not three columns further right.
  paint(vt, 'A')
  expect(row(vt, 12)).toBe('\u001b[0m\u001b[48;2;10;20;30mA  \u001b[0m         \u001b[0m')
})

test('an erase never paints past the last column', () => {
  const vt = new GhosttyVt(8, 2)
  paint(vt, '\u001b[48;2;10;20;30m\u001b[1;6H\u001b[999X')
  // The five cells before the erase keep the default style; the three up to the
  // last column carry the pen. A fourth erased cell would have wrapped.
  expect(row(vt, 8)).toBe('     \u001b[0m\u001b[48;2;10;20;30m   \u001b[0m')
})

test('the cursor is restored after an erase from the start of the line', () => {
  const vt = new GhosttyVt(10, 2)
  paint(vt, '\u001b[48;2;1;2;3mabcdef\u001b[1;1H\u001b[48;2;10;20;30m\u001b[1KX')
  // Erase-to-start covers the first cell only, so the text behind it survives.
  expect(row(vt, 10)).toBe('\u001b[0m\u001b[48;2;10;20;30mX\u001b[0m\u001b[48;2;1;2;3mbcdef\u001b[0m    \u001b[0m')
})

test('a program that sends no erase is untouched', () => {
  const vt = new GhosttyVt(6, 2)
  paint(vt, 'hello')
  expect(row(vt, 6)).toBe('hello \u001b[0m')
})

test('an erase split across two reads is still applied', () => {
  const vt = new GhosttyVt(10, 2)
  paint(vt, '\u001b[48;2;57;61;68m\u001b[')
  paint(vt, 'K')
  expect(row(vt, 10)).toBe('\u001b[0m\u001b[48;2;57;61;68m          \u001b[0m')
})

test('the cell under the cursor is drawn on a reset pen', () => {
  const vt = new GhosttyVt(6, 2)
  // An editor paints the cursor on a cell that belongs to something else: a
  // gutter, a coloured word. The block inverts whatever SGR is open, so the pen
  // has to be reset first or every column's cursor takes a different colour.
  paint(vt, '\u001b[38;2;240;198;116m\u001b[48;2;40;44;52mAB')
  const ink = { draw: (text: string): string => `<${text}>` }
  const line = vt.renderRows(6, 1, { visible: true, x: 1, y: 0, shape: 'block' }, ink)[0] ?? ''
  expect(line).toContain('\u001b[0m<B>')
})

test('the cursor reports the shape the program asked for', () => {
  const vt = new GhosttyVt(6, 2)
  // Neovim sends the insert-mode bar with DECSCUSR and puts the block back when
  // it leaves the mode; the pane draws the cursor itself, so it has to read this.
  expect(vt.cursor().shape).toBe('block')
  paint(vt, '\u001b[6 q')
  expect(vt.cursor().shape).toBe('bar')
  paint(vt, '\u001b[4 q')
  expect(vt.cursor().shape).toBe('underline')
  paint(vt, '\u001b[2 q')
  expect(vt.cursor().shape).toBe('block')
})
