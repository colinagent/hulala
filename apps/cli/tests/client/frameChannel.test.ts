/**
 * The frame channel: a frame the renderer counts as painted has to be a frame the
 * terminal received.
 *
 * pi-tui paints a differential frame against its own copy of the screen and
 * advances that copy as soon as `terminal.write()` returns. The queue underneath
 * makes that return mean "queued", not "painted", so this file is the guard for
 * the two things the queue owes in exchange: a discarded frame is always
 * reported, and a frame composed for a grid the window no longer has is never
 * applied to the new one.
 *
 * Everything here drives `createBufferedOutput` through a real descriptor, which
 * is the only surface the client uses on a terminal: a file stands in for the
 * tty so the bytes can be read back.
 */
import { expect, test } from 'bun:test'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBufferedOutput, type OutputSurface } from '../../src/tui/terminal/writer.ts'

/** One frame, exactly as pi-tui wraps it: synchronized output around every row. */
function frame(rows: string[]): string {
  return `\u001b[?2026h${rows.join('')}\u001b[?2026l`
}

interface Channel {
  surface: ReturnType<typeof createBufferedOutput>
  /** The paint surface handed to pi-tui: a tty whose size a test can change. */
  output: OutputSurface & { fd: number; isTTY: boolean; columns: number; rows: number }
  /** Everything the descriptor was given. */
  written(): string
  close(): void
}

function channel(size = { columns: 80, rows: 24 }): Channel {
  const directory = mkdtempSync(join(tmpdir(), 'hulala-frame-'))
  const path = join(directory, 'tty')
  const fd = openSync(path, 'w')
  const output = {
    fd,
    isTTY: true,
    columns: size.columns,
    rows: size.rows,
    write: (): void => { /* the descriptor is what the queue writes to */ },
  }
  const surface = createBufferedOutput(output, {})
  return {
    surface,
    output,
    written: () => readFileSync(path, 'utf8'),
    close: () => {
      surface.dispose()
      closeSync(fd)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('a frame is stamped with the grid it was composed for, a title is not', async () => {
  const tty = channel()
  tty.surface.write(frame(['\u001b[1;1Hrow one']))
  tty.surface.write('\u001b]0;hulala\u0007')
  await tty.surface.drain()
  expect(tty.written()).toBe(`${frame(['\u001b[1;1Hrow one'])}\u001b]0;hulala\u0007`)
  // One frame in, one frame out; the title is not a frame.
  expect(tty.surface.stats()).toEqual({ composed: 1, committed: 1, lost: { cap: 0, error: 0, geometry: 0 } })
  tty.close()
})

test('a frame composed for the old grid is dropped, not applied to the new one', async () => {
  const tty = channel()
  const lost: string[] = []
  const surface = createBufferedOutput(tty.output, { onLost: reason => lost.push(reason) })
  try {
    // The first frame starts writing; the second is still queued when the window
    // changes size. Absolute rows would land on the wrong lines, and a row one
    // cell too wide would wrap — on the last row, that scrolls everything.
    surface.write(frame(['\u001b[1;1Hfirst']))
    surface.write(frame(['\u001b[22;1Hsecond']))
    tty.output.columns = 70
    tty.output.rows = 20
    await surface.drain()
    expect(tty.written()).toBe(frame(['\u001b[1;1Hfirst']))
    expect(lost).toEqual(['geometry'])
    expect(surface.stats()).toEqual({ composed: 2, committed: 1, lost: { cap: 0, error: 0, geometry: 1 } })
  } finally {
    surface.dispose()
    tty.close()
  }
})

test('a frame that never fits the queue is reported once and never committed', async () => {
  const tty = channel()
  const lost: string[] = []
  // One frame fits, the one behind it does not.
  const surface = createBufferedOutput(tty.output, { capBytes: 100, onLost: reason => lost.push(reason) })
  try {
    surface.write(frame(['\u001b[1;1H' + 'x'.repeat(64)]))
    surface.write(frame(['\u001b[2;1H' + 'y'.repeat(64)])) // over the cap
    await surface.drain()
    // The renderer is told, so its copy of the screen — which already counted the
    // dropped frame — is thrown away instead of being diffed against forever.
    expect(lost).toEqual(['cap'])
    expect(surface.stats()).toEqual({ composed: 2, committed: 1, lost: { cap: 1, error: 0, geometry: 0 } })
  } finally {
    surface.dispose()
    tty.close()
  }
})
