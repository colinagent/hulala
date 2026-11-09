/**
 * Injectable terminal adapter for pi-tui.
 *
 * `ProcessTerminal` hard-codes `process.stdin/stdout`, which makes the client
 * untestable with injected streams. This minimal `Terminal` implementation owns
 * raw mode, stdin framing (via pi-tui's `StdinBuffer`), resize notifications,
 * and the escape-sequence surface pi-tui's renderer calls.
 *
 * It does ask for the Kitty keyboard protocol's *disambiguate* mode, because a
 * macOS terminal will not report a Command chord any other way — and Command is
 * what the frame's divider keys are bound to. Legacy keys keep working: the
 * renderer matches both spellings, and the column programs get the legacy bytes
 * back through `pane/legacyKeys.ts`. Nothing is flipped in pi-tui's own parser
 * state (`kittyProtocolActive` stays false), so a terminal that ignores the
 * request reads exactly like it always did.
 *
 * @module hulala-cli/tui/terminal
 */
import { formatProgramStatus, StdinBuffer, type ProgramStatus, type Terminal } from '@earendil-works/pi-tui'

/** Push the Kitty keyboard protocol's disambiguate mode, keeping older flags. */
const PUSH_DISAMBIGUATE = '\u001b[>1u'

/** Pop it again, restoring whatever the terminal had before the client started. */
const POP_KEYBOARD_PROTOCOL = '\u001b[<u'

/** A whole SGR mouse report: `ESC [ < button ; x ; y` and its final `M`/`m`. */
const SGR_MOUSE_REPORT = /^\u001b\[<\d+;\d+;\d+[Mm]$/u

/** The head of one, which the sequence buffer hands on when it stops waiting. */
const SGR_MOUSE_HEAD = /^\u001b\[<[\d;]*$/u

/** What can still continue that head: more numbers, then one final byte. */
const SGR_MOUSE_TAIL = /^(?:[\d;]{1,10}|[Mm])$/u

export interface TerminalStreams {
  input: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => void; setEncoding?: (encoding: string) => void }
  output: NodeJS.WritableStream & { isTTY?: boolean; columns?: number; rows?: number }
}

export class StreamTerminal implements Terminal {
  private readonly streams: TerminalStreams
  private inputHandler: ((data: string) => void) | undefined
  private resizeHandler: (() => void) | undefined
  private stdinBuffer: StdinBuffer | undefined
  private wasRaw = false
  private rawData: ((chunk: string | Buffer) => void) | undefined
  private detachResize: (() => void) | undefined
  /** True while the tail of a report whose head was dropped is being swallowed. */
  private droppingMouseTail = false

  constructor(streams: TerminalStreams) {
    this.streams = streams
  }

  get columns(): number {
    return this.streams.output.columns ?? 80
  }

  get rows(): number {
    return this.streams.output.rows ?? 24
  }

  get kittyProtocolActive(): boolean {
    return false
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput
    this.resizeHandler = onResize

    const input = this.streams.input
    this.wasRaw = (input as { isRaw?: boolean }).isRaw === true
    input.setRawMode?.(true)
    input.setEncoding?.('utf8')
    if ('resume' in input && typeof input.resume === 'function') input.resume()

    // Bracketed paste so pasted text arrives wrapped in markers.
    this.write('\u001b[?2004h')
    // Push "disambiguate escape codes" (Kitty keyboard protocol flag 1). A
    // terminal without the protocol ignores the sequence; a terminal with it can
    // now report `Cmd-Ctrl-[` as `CSI 91;13u`, which legacy encoding cannot.
    this.write(PUSH_DISAMBIGUATE)

    this.stdinBuffer = new StdinBuffer()
    this.stdinBuffer.on('data', sequence => {
      const kept = this.dropSplitMouseReport(sequence)
      if (kept !== undefined && this.inputHandler) this.inputHandler(kept)
    })
    this.stdinBuffer.on('paste', content => {
      if (this.inputHandler) this.inputHandler(`\u001b[200~${content}\u001b[201~`)
    })
    this.rawData = (chunk: string | Buffer): void => {
      this.stdinBuffer?.process(chunk)
    }
    input.on('data', this.rawData)

    const output = this.streams.output as { on?: (event: string, listener: () => void) => void; removeListener?: (event: string, listener: () => void) => void }
    if (output.on !== undefined) {
      output.on('resize', onResize)
    }
    const onSigwinch = (): void => {
      this.resizeHandler?.()
    }
    process.on('SIGWINCH', onSigwinch)
    this.detachResize = () => {
      process.removeListener('SIGWINCH', onSigwinch)
      if (output.removeListener !== undefined) output.removeListener('resize', onResize)
    }
  }

  stop(): void {
    if (this.rawData !== undefined) this.streams.input.off('data', this.rawData)
    this.rawData = undefined
    this.droppingMouseTail = false
    this.stdinBuffer?.clear()
    this.stdinBuffer = undefined
    this.detachResize?.()
    this.detachResize = undefined
    // Pop the keyboard mode before the paste mode: the terminal must go back to
    // the encoding the shell expects.
    this.write(POP_KEYBOARD_PROTOCOL)
    this.write('\u001b[?2004l')
    this.streams.input.setRawMode?.(this.wasRaw)
    this.inputHandler = undefined
    this.resizeHandler = undefined
  }

  /**
   * Drop the two halves of a mouse report the sequence buffer gave up on.
   *
   * `StdinBuffer` flushes a sequence it could not finish inside its 50 ms window,
   * so a report split by a slow read arrives as `ESC [ < 35;6` and then as plain
   * characters. Everything above this layer reads those as keystrokes, and a
   * column with the keyboard forwards them to its program: the shell's line
   * editor swallows `ESC [ <`, beeps, and prints `35;67;18M` on its input line as
   * text instead of treating it as a click. Whole reports still pass through —
   * that is what pi-tui's own mouse handling reads.
   * @param sequence - one sequence from the input buffer.
   * @returns the sequence to deliver, or undefined when it belonged to a report.
   */
  private dropSplitMouseReport(sequence: string): string | undefined {
    if (this.droppingMouseTail) {
      // The tail is typed as ordinary characters, one per event. Anything that
      // cannot continue a report means the reader is typing again, so the key is
      // delivered rather than eaten.
      if (!SGR_MOUSE_TAIL.test(sequence)) {
        this.droppingMouseTail = false
        return sequence
      }
      if (sequence === 'M' || sequence === 'm') this.droppingMouseTail = false
      return undefined
    }
    if (SGR_MOUSE_HEAD.test(sequence) && !SGR_MOUSE_REPORT.test(sequence)) {
      this.droppingMouseTail = true
      return undefined
    }
    return sequence
  }

  write(data: string): void {
    this.streams.output.write(data)
  }

  moveBy(lines: number): void {
    if (lines < 0) this.write(`\u001b[${-lines}A`)
    else if (lines > 0) this.write(`\u001b[${lines}B`)
  }

  hideCursor(): void {
    this.write('\u001b[?25l')
  }

  showCursor(): void {
    this.write('\u001b[?25h')
  }

  clearLine(): void {
    this.write('\u001b[2K')
  }

  clearFromCursor(): void {
    this.write('\u001b[J')
  }

  clearScreen(): void {
    this.write('\u001b[2J\u001b[H')
  }

  setTitle(title: string): void {
    this.write(`\u001b]0;${title}\u0007`)
  }

  setProgress(active: boolean): void {
    this.write(active ? '\u001b]9;4;3\u0007' : '\u001b]9;4;0\u0007')
  }

  setProgramStatus(status: ProgramStatus): void {
    this.write(formatProgramStatus(status))
  }

  async drainInput(): Promise<void> {
    // No Kitty keyboard protocol to drain.
  }
}
