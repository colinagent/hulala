import { expect, test } from 'bun:test'
import { compositeTuiLine, visibleWidth } from '@earendil-works/pi-tui'

/**
 * The rendering contract the sidebar depends on.
 *
 * A kitty/iTerm2 placement is a zero-width sequence pinned to the cell where it is
 * written, so a row that carries one is still a text row: the columns to its right
 * must keep compositing. Upstream `compositeTuiLine()` returned such a row untouched,
 * which silently blanked the first row of the terminal column next to the home
 * banner's mark — the shell prompt lives on exactly that row. These tests fail
 * against the unpatched package, so they guard `patches/@earendil-works%2Fpi-tui`.
 */

/** One kitty transmission chunk, as `Image` emits it: `C=1` does not move the cursor. */
const KITTY = '\x1b_Ga=T,f=100,q=2,C=1,c=8,r=4,i=7,m=1;AAAA\x1b\\'

test('a column to the right of an image row is composited, not dropped', () => {
  // The home frame: rail (24) | divider | conversation (41, carrying the mark) |
  // divider | terminal column (83), on a 150-column terminal.
  const conversation = `  ${KITTY}  hulala v0.2.2`
  const prompt = 'colin@host project %'

  let row = compositeTuiLine('', ' '.repeat(24), 0, 24, 150)
  row = compositeTuiLine(row, conversation, 25, 41, 150)
  row = compositeTuiLine(row, prompt, 67, 83, 150)

  expect(row).toContain('\x1b_G')
  expect(row).toContain('hulala v0.2.2')
  expect(row).toContain(prompt)
  expect(visibleWidth(row)).toBe(150)
})

test('a row without a placement composites exactly as before', () => {
  const row = compositeTuiLine('rail'.padEnd(25), 'text', 25, 41, 150)
  expect(row).toContain('rail')
  expect(row).toContain('text')
  expect(visibleWidth(row)).toBe(150)
})

test('an unterminated placement leaves the row alone', () => {
  const broken = `${KITTY.slice(0, -2)} trailer`
  expect(compositeTuiLine(broken, 'text', 25, 41, 150)).toBe(broken)
})
