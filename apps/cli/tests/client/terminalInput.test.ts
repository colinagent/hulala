/**
 * What the terminal adapter does with a mouse report a slow read cut in half.
 *
 * A report is five fields and one final byte, and `StdinBuffer` gives up on a
 * sequence it cannot finish inside its 50 ms window. A link that stalls can
 * therefore deliver `ESC [ < 0 ; 5 ; 3` and `M` as two separate reads. Neither
 * half is a report, and delivering either as input types garbage; dropping both
 * loses the click. The adapter holds the head and completes it, which is what a
 * terminal fast enough to send the report whole would have produced.
 */
import { expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import { createTerminalGuard } from '../../src/tui/terminal/guard.js'
import { StreamTerminal, type TerminalStreams } from '../../src/tui/terminal.js'

interface Harness {
  readonly input: PassThrough
  /** The sequences the renderer received, in order. */
  readonly received: string[]
  /** Feed raw bytes as one `data` event, the way a pty delivers a read. */
  send(data: string): void
  /** Forget held bytes, the way a wake or a rebuilt transport does. */
  reset(reason: string): void
  stop(): void
}

function harness(escapeTimeoutMs?: number, orphanWindowMs?: number, trace?: string[]): Harness {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (_mode: boolean): void => undefined,
    setEncoding: (): void => undefined,
  })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 })
  output.on('data', () => undefined)
  const received: string[] = []
  const terminal = new StreamTerminal(
    { input, output } as unknown as TerminalStreams,
    {
      escapeTimeoutMs: escapeTimeoutMs ?? 120,
      reportTimeoutMs: escapeTimeoutMs ?? 120,
      ...(orphanWindowMs === undefined ? {} : { orphanWindowMs }),
      ...(trace === undefined ? {} : { trace: (line: string) => { trace.push(line) } }),
    },
  )
  terminal.start(sequence => received.push(sequence), () => undefined)
  return {
    input,
    received,
    send: data => { input.write(data) },
    reset: reason => { terminal.resetInput(reason) },
    stop: () => {
      terminal.stop()
      input.destroy()
      output.destroy()
    },
  }
}

/**
 * Wait long enough for the harness's stream to deliver, but not long enough for
 * the hold timeout to expire: a join across reads is what most tests pin.
 */
const flush = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 20))
}

test('a report split by the read is delivered whole once its tail arrives', async () => {
  const h = harness()
  h.send('\u001b[<0;5;3')
  await flush()
  // The head alone is not delivered: it is not a keystroke and not a report.
  expect(h.received).toEqual([])
  h.send('M')
  expect(h.received).toEqual(['\u001b[<0;5;3M'])
  h.stop()
})

test('a tail that arrives one character at a time still completes the report', async () => {
  const h = harness()
  h.send('\u001b[<32;6;')
  await flush()
  for (const character of '2M') {
    h.send(character)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(h.received).toEqual(['\u001b[<32;6;2M'])
  h.stop()
})

test('a stale half report is given up on, so it cannot swallow later typing', async () => {
  const h = harness(30)
  h.send('\u001b[<0;5;')
  await flush()
  await new Promise(resolve => setTimeout(resolve, 60))
  h.send('3')
  h.send('M')
  expect(h.received).toEqual(['3', 'M'])
  h.stop()
})

test('whole reports pass through untouched and in order', async () => {
  const h = harness()
  h.send('\u001b[<0;5;3M\u001b[<32;6;3M\u001b[<0;6;3m')
  expect(h.received).toEqual(['\u001b[<0;5;3M', '\u001b[<32;6;3M', '\u001b[<0;6;3m'])
  h.stop()
})

test('a wheel report split in half still scrolls once', async () => {
  const h = harness()
  h.send('\u001b[<64;10;')
  await flush()
  h.send('4M')
  expect(h.received).toEqual(['\u001b[<64;10;4M'])
  h.stop()
})

test('a "head" longer than any report is dropped instead of buffered', async () => {
  const h = harness()
  h.send(`\u001b[<${'1'.repeat(80)}`)
  await flush()
  expect(h.received).toEqual([])
  // The stream is still usable afterwards: a real report is delivered.
  h.send('\u001b[<0;5;3M')
  expect(h.received).toEqual(['\u001b[<0;5;3M'])
  h.stop()
})

test('a split before the `<` is held too, not typed', async () => {
  // A fast pointer splits the report wherever the read boundary falls. Holding
  // only `ESC [ <` fragments meant a split after `ESC [` reached the frame as
  // text, which is how moving the mouse typed `<35;58;41M` into the composer.
  // Split 1 is the Escape key itself: a lone ESC is a key, and the sequence
  // buffer has already waited for a sequence that never came.
  for (const split of [2, 3]) {
    const h = harness()
    const report = '\u001b[<35;58;41M'
    h.send(report.slice(0, split))
    await flush()
    expect(h.received).toEqual([])
    h.send(report.slice(split))
    await flush()
    expect(h.received).toEqual([report])
    h.stop()
  }
})

test('a lone Escape is still a key, not a held fragment', async () => {
  const h = harness()
  h.send('\u001b')
  // The escape waits its hold out (it may be a report head), then it is the key.
  await new Promise(resolve => setTimeout(resolve, 150))
  expect(h.received).toEqual(['\u001b'])
  h.stop()
})

test('a report split right after the escape is still a report', async () => {
  // A busy frame reads stdin in small chunks, and the escape is where the split
  // lands: the head waits a moment for the `[`, and only then becomes the key.
  const h = harness()
  h.send('\u001b')
  h.send('[<64;10;5M')
  await flush()
  expect(h.received).toEqual(['\u001b[<64;10;5M'])
  h.stop()
})

test('a held escape is given back before the key that follows it', async () => {
  // Two escapes, or an escape and a key, arriving inside the hold must not lose
  // the first one: it is a key in its own right and it comes first.
  const h = harness()
  // A gap, because two escapes in one read are one sequence the frame reads as
  // the double-escape chord.
  h.send('\u001b')
  await new Promise(resolve => setTimeout(resolve, 120))
  h.send('\u001b')
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(h.received).toEqual(['\u001b', '\u001b'])
  h.received.length = 0
  // A separate read, but inside the hold: the escape is still pending when the
  // key arrives. Both bytes in one read would be the Alt-j chord instead.
  // A character arriving while the escape is still held is the Alt chord the
  // terminal sent: `ESC j` in one breath is Alt-j, not Escape then j.
  h.send('\u001b')
  await new Promise(resolve => setTimeout(resolve, 10))
  h.send('j')
  await flush()
  expect(h.received).toEqual(['\u001bj'])
  h.stop()
})

test('a paste that arrives in pieces is delivered once, whole', async () => {
  // A paste's content is opaque and can be megabytes, so a read ends anywhere
  // inside it. Half a paste used to paste its own marker and type the rest.
  const h = harness()
  h.send('\u001b[200~line one\n')
  await flush()
  expect(h.received).toEqual([])
  h.send('line two')
  await flush()
  expect(h.received).toEqual([])
  h.send('\u001b[201~')
  await flush()
  expect(h.received).toEqual(['\u001b[200~line one\nline two\u001b[201~'])
  h.stop()
})

test('a paste whose content looks like a report stays a paste', async () => {
  const h = harness()
  h.send('\u001b[200~ESC [ < 0 ; 1 ; 1 M')
  await flush()
  h.send('\u001b[201~')
  await flush()
  expect(h.received).toEqual(['\u001b[200~ESC [ < 0 ; 1 ; 1 M\u001b[201~'])
  h.stop()
})

test('a report whose escape was read alone is rejoined, not typed', async () => {
  // The sequence buffer flushes a lone ESC after ten milliseconds. When the rest
  // of a pointer report is read separately, the escape reaches the frame as the
  // Escape key and the tail as twelve characters — `[<35;43;38M` in the composer.
  const h = harness()
  h.send('\u001b')
  // Inside the escape hold: the two halves become the report they are, and no
  // Escape key is invented (which would move the keyboard out of the composer).
  await new Promise(resolve => setTimeout(resolve, 10))
  h.send('[<35;43;38M')
  await flush()
  expect(h.received).toEqual(['\u001b[<35;43;38M'])
  h.stop()
})

test('a tail that arrives after the escape was given back is still a report', async () => {
  const h = harness()
  h.send('\u001b')
  // Past the escape hold, so the frame already saw the Escape key.
  await new Promise(resolve => setTimeout(resolve, 200))
  h.send('[<35;43;38M')
  await flush()
  expect(h.received).toEqual(['\u001b', '\u001b[<35;43;38M'])
  h.stop()
})

test('a "[" typed right after an Escape still arrives as text', async () => {
  const h = harness()
  h.send('\u001b')
  await new Promise(resolve => setTimeout(resolve, 40))
  h.send('[')
  await new Promise(resolve => setTimeout(resolve, 250))
  // `ESC [` is also the start of every CSI, so it waits; when nothing follows,
  // the escape is the key it was and the bracket is text.
  expect(h.received).toEqual(['\u001b', '['])
  h.stop()
})

test('a report that lost its escape entirely is still a report', async () => {
  // The sequence buffer emits anything that does not begin with an escape one
  // character at a time, so the tail reaches the frame as `[`, `<`, `3`, … — and
  // that is exactly what used to be typed into the composer.
  const h = harness()
  h.send('[')
  await flush()
  expect(h.received).toEqual([])
  for (const character of '<35;43;38M') h.send(character)
  await flush()
  expect(h.received).toEqual(['\u001b[<35;43;38M'])
  h.stop()
})

test('a lone "[" is still text, after the short wait', async () => {
  const h = harness()
  h.send('[')
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(h.received).toEqual(['['])
  h.stop()
})

test('"[" followed by real typing is not held', async () => {
  const h = harness()
  h.send('[')
  h.send('x')
  await flush()
  // `[<` is held only while it could still be a report; with `x` after it, both
  // characters are keys, in the order they were typed.
  expect(h.received).toEqual(['[', 'x'])
  h.stop()
})

test('a closed window ends the client instead of leaving it attached', async () => {
  // A client whose terminal is gone keeps a Host connection and a forward open
  // forever; several of those on one Host are indistinguishable from the window
  // the user is typing into, and one of them runs an older build.
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (_mode: boolean): void => undefined,
    setEncoding: (): void => undefined,
  })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 })
  output.on('data', () => undefined)
  let hangups = 0
  const terminal = new StreamTerminal({ input, output } as unknown as TerminalStreams)
  terminal.onHangup(() => { hangups += 1 })
  terminal.start(() => undefined, () => undefined)
  input.end()
  await new Promise(resolve => setTimeout(resolve, 40))
  expect(hangups).toBe(1)
  terminal.stop()
  // `stop()` detaches, so a late close cannot fire it again.
  input.emit('close')
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(hangups).toBe(1)
})

test('the terminal is given back on every way out, once', () => {
  // A client that dies without this leaves the terminal in the alternate screen
  // with mouse reporting on, and the shell that comes back receives the pointer
  // reports and echoes them as text — the terminal has to be closed by hand.
  const written: string[] = []
  const guard = createTerminalGuard(text => { written.push(text) })
  guard.restore()
  // Nothing was taken yet, so nothing is given back.
  expect(written).toEqual([])
  guard.install()
  guard.restore()
  guard.restore()
  expect(written).toHaveLength(1)
  expect(written[0]).toContain('\u001b[?1049l')
  expect(written[0]).toContain('\u001b[?1006l')
  expect(written[0]).toContain('\u001b[?1003l')
  expect(written[0]).toContain('\u001b[?2004l')
  expect(written[0]).toContain('\u001b[?2026l')
  expect(written[0]).toContain('\u001b[0 q')
  expect(written[0]).toContain('\u001b[?25h')
})

test('a paste that waits longer than the escape hold is still one paste', async () => {
  // A paste's content arrives at the speed of the source; a slow terminal can
  // leave the head waiting far longer than a lone Escape ever should. Handing
  // it back as keys would type `[200~line one` into the composer, which is the
  // same class of bug as a split report — and it was live until this test.
  const h = harness(30)
  h.send('\u001b[200~line one\n')
  await new Promise(resolve => setTimeout(resolve, 150))
  h.send('line two\u001b[201~')
  await flush()
  expect(h.received).toEqual(['\u001b[200~line one\nline two\u001b[201~'])
  h.stop()
})

test('a tail past the orphan window is dropped, never typed', async () => {
  const h = harness(30, 60)
  h.send('\u001b')
  // The hold expires and the Escape key is delivered.
  await new Promise(resolve => setTimeout(resolve, 130))
  expect(h.received).toEqual(['\u001b'])
  // The tail arrives after the escape AND after the rejoin window: typing it is
  // the `[C` / `[D` garbage, so the adapter drops it instead.
  h.send('[D')
  await flush()
  expect(h.received).toEqual(['\u001b'])
  h.stop()
})

/**
 * What a truncated tty leaves behind: a report with none of `ESC [ <` in front
 * of it. The pty input queue holds about a kilobyte, so a terminal that is not
 * being read loses the introducer of whatever report it was writing, and the
 * digits that survive are printable. Typed into the composer they read
 * `60;39M65;60;39M…`, which is the screen a user sees after a wake.
 */
test('a report that lost its introducer is dropped, not typed', async () => {
  const trace: string[] = []
  const h = harness(undefined, undefined, trace)
  h.send('\u001b[<64;60;39M')
  await flush()
  h.send('65;60;39M60;39M')
  await flush()
  expect(h.received).toEqual(['\u001b[<64;60;39M'])
  expect(trace.filter(line => line.startsWith('damaged '))).toEqual([
    'damaged "65;60;39M"',
    'damaged "60;39M"',
  ])
  h.stop()
})

test('typing right after a report is still typing', async () => {
  const h = harness()
  h.send('\u001b[<0;5;3M')
  await flush()
  h.send('5M')
  await flush()
  expect(h.received).toEqual(['\u001b[<0;5;3M', '5', 'M'])
  h.stop()
})

test('resetInput drops half a sequence instead of handing it back as keys', async () => {
  const trace: string[] = []
  const h = harness(undefined, undefined, trace)
  h.send('\u001b[<0;5;')
  await flush()
  expect(h.received).toEqual([])
  h.reset('test')
  await flush()
  // A half report that outlived its terminal is not a keystroke: the wake path
  // drops it, and the trace says what was dropped and why.
  expect(h.received).toEqual([])
  expect(trace.filter(line => line.startsWith('reset '))).toEqual([
    'reset test dropped "\\u001b[<0;5;"',
  ])
  // The stream is usable afterwards.
  h.send('\u001b[<0;5;3M')
  await flush()
  expect(h.received).toEqual(['\u001b[<0;5;3M'])
  h.stop()
})
