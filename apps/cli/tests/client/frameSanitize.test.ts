/**
 * A frame row is a row of *cells*, never a terminal instruction.
 *
 * The bug this guards against was a folded Bash command: `truncateToWidth`
 * measures a newline as zero columns but keeps the byte, so a multi-line script
 * handed to a one-line preview painted its second and third source lines into
 * the rows below. pi-tui's diff believed those rows were unchanged and never
 * repainted them, which is why the newest transcript text sat in the composer
 * with no lost frame, no resize and no rebuild to explain it.
 *
 * These tests drive the real output surface (a file standing in for the tty)
 * and the client's own terminal emulator, so both halves of the claim are
 * checked: the bytes that leave the client, and what a terminal does with them.
 */
import { expect, test } from 'bun:test'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GhosttyVt } from '../../src/tui/pane/ghosttyVt.js'
import {
  createBufferedOutput,
  sanitizeFrame,
  type FrameControl,
  type OutputSurface,
} from '../../src/tui/terminal/writer.ts'

const START = '\u001b[?2026h'
const END = '\u001b[?2026l'
/** One frame, exactly as pi-tui wraps it: absolute row moves and row text. */
const frame = (parts: string[]): string => `${START}${parts.join('')}${END}`
const row = (n: number, text: string): string => `\u001b[${String(n)};1H\u001b[2K${text}`

/** A tty-shaped surface whose descriptor can be read back. */
function channel(): {
  output: OutputSurface & { fd: number; isTTY: boolean; columns: number; rows: number }
  written: () => string
  close: () => void
} {
  const directory = mkdtempSync(join(tmpdir(), 'hulala-sanitize-'))
  const path = join(directory, 'tty')
  const fd = openSync(path, 'w')
  return {
    output: {
      fd,
      isTTY: true,
      columns: 80,
      rows: 24,
      write: (): void => { /* the descriptor is what the queue writes to */ },
    },
    written: () => readFileSync(path, 'utf8'),
    close: () => { closeSync(fd); rmSync(directory, { recursive: true, force: true }) },
  }
}

test('bare controls are dropped and named by row, escape sequences are kept', () => {
  const dirty = frame([
    row(3, "python3 - <<'PY'\nprint(1)\r\b\u0000\u007fend"),
    `\u001b[4;1H\u001b[38;2;1;2;3mink\u001b[0m`,
    `\u001b]8;;https://example.com\u0007link\u001b]8;;\u001b\\`,
    `\u001bP+q;kitty\u001b\\\u001b7\u001b `,
  ])
  const { text, controls } = sanitizeFrame(dirty)
  expect(text).toBe(frame([
    row(3, "python3 - <<'PY'print(1)end"),
    `\u001b[4;1H\u001b[38;2;1;2;3mink\u001b[0m`,
    `\u001b]8;;https://example.com\u0007link\u001b]8;;\u001b\\`,
    `\u001bP+q;kitty\u001b\\\u001b7 `,
  ]))
  expect(controls).toEqual([
    { row: 3, code: 0x0a, count: 1 },
    { row: 3, code: 0x0d, count: 1 },
    { row: 3, code: 0x08, count: 1 },
    { row: 3, code: 0x00, count: 1 },
    { row: 3, code: 0x7f, count: 1 },
    { row: 4, code: 0x1b, count: 1 }, // lone escape, treated as data not a sequence
  ])
})

test('an unterminated OSC is dropped instead of swallowing the rest of the frame', () => {
  const { text, controls } = sanitizeFrame(frame([row(1, '\u001b]0;never closed, still cells')]))
  expect(text).toBe(frame([row(1, ']0;never closed, still cells')]))
  expect(controls).toEqual([{ row: 1, code: 0x1b, count: 1 }])
})

test('a frame is sanitized, a title is not, and the removal is reported', async () => {
  const tty = channel()
  const controls: FrameControl[][] = []
  const surface = createBufferedOutput(tty.output, { onControl: found => controls.push([...found]) })
  try {
    const title = '\u001b]0;hulala\u0007'
    surface.write(frame([row(2, `first\nsecond`)]))
    surface.write(title)
    await surface.drain()
    expect(tty.written()).toBe(`${frame([row(2, 'firstsecond')])}${title}`)
    expect(controls).toEqual([[{ row: 2, code: 0x0a, count: 1 }]])
    // Only the frame is counted; a title is a control write, not a frame.
    expect(surface.stats()).toEqual({ composed: 1, committed: 1, lost: { cap: 0, error: 0, geometry: 0 } })
  } finally {
    surface.dispose()
    tty.close()
  }
})

test('a frame is sanitized even before the grid is known', async () => {
  const tty = channel()
  // Omit the size entirely: exactOptionalPropertyTypes forbids `columns: undefined`.
  const { columns: _columns, rows: _rows, ...noGrid } = tty.output
  const controls: FrameControl[][] = []
  const surface = createBufferedOutput(noGrid, { onControl: found => controls.push([...found]) })
  try {
    surface.write(frame([row(1, 'first\nsecond')]))
    await surface.drain()
    expect(tty.written()).toBe(frame([row(1, 'firstsecond')]))
    expect(controls).toEqual([[{ row: 1, code: 0x0a, count: 1 }]])
    // Still a frame, but with no grid to stamp: it is not counted as one.
    expect(surface.stats().composed).toBe(0)
  } finally {
    surface.dispose()
    tty.close()
  }
})

const COLS = 60
const ROWS = 6
const encoder = new TextEncoder()
/** Strip SGR/cursor sequences so a VT row can be compared with the model. */
const plain = (line: string): string => line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, '')
const screen = (vt: GhosttyVt): string[] => vt.renderRows(COLS, ROWS, undefined, undefined).map(plain)

/** Paint the rows pi-tui considers changed, optionally through the sanitizer. */
function paint(vt: GhosttyVt, rows: string[], changed: number[], sanitize: boolean): void {
  const parts = rows.flatMap((text, index) => changed.includes(index) ? [row(index + 1, text)] : [])
  const data = frame(parts)
  vt.write(encoder.encode(sanitize ? sanitizeFrame(data).text : data))
}

/** The folded command that caused the ghost: a preview row holding raw LF. */
function model(): string[] {
  return ['', "❯ python3 - <<'PY'\nfor k,v in m.items():…", '', '', '', '']
}

test('a raw LF leaves text on rows the model calls blank', () => {
  const vt = new GhosttyVt(COLS, ROWS)
  const rows = model()
  paint(vt, rows, [0, 1, 2, 3, 4, 5], false)
  // Streaming delta: only the tool row changed, so the diff repaints just it.
  rows[1] = "❯ python3 - <<'PY'\nprint('winner':991810)…"
  paint(vt, rows, [1], false)
  const painted = screen(vt)
  expect(painted[1]).toContain("❯ python3 - <<'PY'")
  expect(painted.slice(2).some(line => line.includes('winner'))).toBe(true)
  vt.dispose()
})

test('sanitizing the frame keeps the model and the terminal in step', () => {
  const vt = new GhosttyVt(COLS, ROWS)
  const rows = model()
  paint(vt, rows, [0, 1, 2, 3, 4, 5], true)
  rows[1] = "❯ python3 - <<'PY'\nprint('winner':991810)…"
  paint(vt, rows, [1], true)
  const painted = screen(vt)
  expect(painted[1]).toContain("❯ python3 - <<'PY'")
  expect(painted[1]).toContain('winner')
  expect(painted.slice(2).map(line => line.trim())).toEqual(['', '', '', ''])
  vt.dispose()
})
