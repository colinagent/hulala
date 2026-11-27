/**
 * The window's focus, as the terminal wrapper reads it.
 *
 * `?1004` is the only way a terminal program learns that nobody is looking at
 * it. The input-source ownership asks before it changes the machine's keyboard,
 * so the report has to be read *before* the alt-screen's own listener (which
 * consumes it in `handleViewportInput`), and only its meaning may travel.
 */
import { expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import { StreamTerminal, type TerminalStreams } from '../../src/tui/terminal.js'

interface Harness {
  /** Focus reports the wrapper recognised, in order. */
  readonly focus: boolean[]
  /** Everything the screen received. */
  readonly received: string[]
  send(data: string): void
  stop(): void
}

function harness(): Harness {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (_mode: boolean): void => undefined,
    setEncoding: (): void => undefined,
  })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 })
  output.on('data', () => undefined)
  const focus: boolean[] = []
  const received: string[] = []
  const terminal = new StreamTerminal(
    { input, output } as unknown as TerminalStreams,
    { escapeTimeoutMs: 120, reportTimeoutMs: 120 },
  )
  terminal.onFocusReport(focused => { focus.push(focused) })
  terminal.start(piece => { received.push(piece) }, () => undefined)
  return {
    focus,
    received,
    send: data => { input.write(data) },
    stop: () => {
      terminal.stop()
      input.destroy()
      output.destroy()
    },
  }
}

const flush = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 40)) }

test('focus out and focus in are state, and still reach the screen', async () => {
  const tty = harness()
  try {
    tty.send('\u001b[O')
    tty.send('\u001b[I')
    await flush()
    expect(tty.focus).toEqual([false, true])
    // The bytes are also delivered: the alt-screen clears a drag in progress on
    // blur, and it is the screen — not this wrapper — that decides that. It
    // consumes them there, so they can never be typed.
    expect(tty.received).toContain('\u001b[O')
    expect(tty.received).toContain('\u001b[I')
  } finally {
    tty.stop()
  }
})

test('a report split across reads is not a report until it is whole', async () => {
  const tty = harness()
  try {
    tty.send('\u001b[')
    await flush()
    expect(tty.focus).toEqual([])
    tty.send('O')
    await flush()
    expect(tty.focus).toEqual([false])
  } finally {
    tty.stop()
  }
})

test('ordinary keys are never mistaken for a focus report', async () => {
  const tty = harness()
  try {
    tty.send('I')
    tty.send('O')
    tty.send('\u001b[A')
    await flush()
    expect(tty.focus).toEqual([])
    expect(tty.received).toEqual(expect.arrayContaining(['I', 'O']))
  } finally {
    tty.stop()
  }
})
