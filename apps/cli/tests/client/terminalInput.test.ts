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
import { StreamTerminal, type TerminalStreams } from '../../src/tui/terminal.js'

interface Harness {
  readonly input: PassThrough
  /** The sequences the renderer received, in order. */
  readonly received: string[]
  /** Feed raw bytes as one `data` event, the way a pty delivers a read. */
  send(data: string): void
  stop(): void
}

function harness(mouseReportTimeoutMs?: number): Harness {
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
    mouseReportTimeoutMs === undefined ? {} : { mouseReportTimeoutMs },
  )
  terminal.start(sequence => received.push(sequence), () => undefined)
  return {
    input,
    received,
    send: data => { input.write(data) },
    stop: () => {
      terminal.stop()
      input.destroy()
      output.destroy()
    },
  }
}

/** Wait past the sequence buffer's flush window, so a head is really flushed. */
const flush = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 80))
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

test('a key typed after a lost tail is delivered instead of being eaten', async () => {
  const h = harness()
  h.send('\u001b[<0;5;')
  await flush()
  h.send('q')
  expect(h.received).toEqual(['q'])
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
  await flush()
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
  await flush()
  h.send('\u001b')
  await flush()
  expect(h.received).toEqual(['\u001b', '\u001b'])
  h.received.length = 0
  // A separate read, but inside the hold: the escape is still pending when the
  // key arrives. Both bytes in one read would be the Alt-j chord instead.
  h.send('\u001b')
  await new Promise(resolve => setTimeout(resolve, 10))
  h.send('j')
  await flush()
  expect(h.received).toEqual(['\u001b', 'j'])
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
  await new Promise(resolve => setTimeout(resolve, 40))
  h.send('[<35;43;38M')
  await flush()
  expect(h.received).toEqual(['\u001b[<35;43;38M'])
  h.stop()
})

test('a tail that arrives after the escape was given back is still a report', async () => {
  const h = harness()
  h.send('\u001b')
  // Past the escape hold, so the frame already saw the Escape key.
  await new Promise(resolve => setTimeout(resolve, 120))
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
  expect(h.received).toEqual(['\u001b', '['])
  h.stop()
})
