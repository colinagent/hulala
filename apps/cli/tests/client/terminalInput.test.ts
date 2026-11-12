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
