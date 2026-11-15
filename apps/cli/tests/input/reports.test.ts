/**
 * A stray terminal reply must never become typing.
 *
 * The repro came from a remote attach: a palette query's answers sat in the
 * tty's canonical buffer (no newline, so the line discipline never handed them
 * on), and the next raw-mode switch released the whole burst into the input
 * pipeline. The composer received `62`, `22t`, `52c`; after the client exited,
 * the shell received the same bytes as `command not found`.
 */
import { expect, test } from 'bun:test'
import { isStrayTerminalReport } from '../../src/tui/input/reports.ts'

/** The exact burst pi-tui asks for: size, colors, then DA1 to end the round. */
const paletteRound = [
  '\u001b[6;34;16t',
  ...['10;rgb:ffff/ffff/ffff', '11;rgb:2828/2c2c/3434'].map(body => `\u001b]${body}\u0007`),
  ...Array.from({ length: 16 }, (_, i) => `\u001b]4;${String(i)};rgb:1d1d/1f1f/2121\u0007`),
  '\u001b[?62;22;52c',
]

test('palette answers and DA1 are swallowed, whichever terminator they use', () => {
  expect(paletteRound.filter(isStrayTerminalReport)).toEqual(paletteRound.slice(1))
  // `CSI 6;height;width t` belongs to pi-tui's cell-size consumer, not here.
  expect(isStrayTerminalReport(paletteRound[0]!)).toBe(false)
  expect(isStrayTerminalReport('\u001b]10;rgb:ffff/ffff/ffff\u001b\\')).toBe(true)
  expect(isStrayTerminalReport('\u001b]4;7;?\u0007')).toBe(true)
})

test('other terminal-initiated reports are swallowed', () => {
  expect(isStrayTerminalReport('\u001b[?1;2c')).toBe(true) // DA1
  expect(isStrayTerminalReport('\u001b[>0;95;0c')).toBe(true) // DA2
  expect(isStrayTerminalReport('\u001b[24;80R')).toBe(true) // cursor position
  expect(isStrayTerminalReport('\u001b[?1;2n')).toBe(true) // device status
  expect(isStrayTerminalReport('\u001b[4;100;800t')).toBe(true) // window pixels
  expect(isStrayTerminalReport('\u001b[3;10;20t')).toBe(true) // window position
})

test('real keys and Alt chords are never mistaken for reports', () => {
  for (const key of [
    '\u001b[D', '\u001b[C', '\u001b[1;5A', '\u001b[3~', '\u001bOP',
    '\u001b[27;5;93~', '\u001b[91;13u', '\u001b[200~', '\u001b[201~',
    '\u001bO', '\u001b', '\r', 'a', '62', '[D', '6;34;16t',
    '\u001b[<35;4;9M', '\u001b[I', '\u001b[O',
  ]) {
    expect(isStrayTerminalReport(key), key).toBe(false)
  }
})
