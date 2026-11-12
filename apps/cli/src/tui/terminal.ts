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
 * The sequence buffer gives up on a sequence it cannot finish in time, which is
 * right for a key and wrong for a mouse report: one report is one gesture, and
 * the halves mean nothing apart. So a flushed half report is held here until the
 * rest of it arrives, and only a tail that never comes is dropped (see
 * `reassembleMouseReport`).
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

/**
 * The longest a real report can be, and therefore the longest head worth holding.
 *
 * `ESC [ <` then three numbers: a button byte and two coordinates that fit in
 * sixteen bits each stay well inside this. A longer "head" is not a report the
 * terminal is finished sending; it is a broken stream, and holding it would grow
 * a buffer on the strength of whatever arrives next.
 */
const SGR_MOUSE_MAX_LENGTH = 64

/**
 * How long half a report is held before it is given up on.
 *
 * A slow read can split one report, but the halves arrive milliseconds apart:
 * a head still waiting after a whole second belongs to a report whose tail was
 * lost, and holding it longer would let an unrelated key complete it.
 */
const MOUSE_REPORT_TIMEOUT_MS = 1_000

/**
 * Bytes that would end an OSC title early or start a sequence inside it.
 *
 * A window title can carry Host-written text (a Session title), which is not
 * trusted to be inert: a BEL or ESC in it would end `OSC 0` and hand the rest
 * to the terminal as escape sequences. A space keeps the words apart.
 */
const TITLE_CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu

export interface TerminalStreams {
  input: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => void; setEncoding?: (encoding: string) => void }
  output: NodeJS.WritableStream & { isTTY?: boolean; columns?: number; rows?: number }
}

/** Timing knobs a test can shorten; the client always takes the defaults. */
export interface TerminalOptions {
  /** How long half a mouse report waits for its tail. */
  readonly mouseReportTimeoutMs?: number
}

export class StreamTerminal implements Terminal {
  private readonly streams: TerminalStreams
  private readonly mouseReportTimeoutMs: number
  private inputHandler: ((data: string) => void) | undefined
  private resizeHandler: (() => void) | undefined
  private stdinBuffer: StdinBuffer | undefined
  private wasRaw = false
  private rawData: ((chunk: string | Buffer) => void) | undefined
  private detachResize: (() => void) | undefined
  /** Half a mouse report, held until its tail arrives or is given up on. */
  private pendingMouseReport: string | undefined
  private pendingMouseTimer: ReturnType<typeof setTimeout> | undefined

  constructor(streams: TerminalStreams, options: TerminalOptions = {}) {
    this.streams = streams
    this.mouseReportTimeoutMs = options.mouseReportTimeoutMs ?? MOUSE_REPORT_TIMEOUT_MS
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
      const kept = this.reassembleMouseReport(sequence)
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
    this.clearPendingMouseReport()
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
   * Join the halves of a mouse report the sequence buffer gave up on.
   *
   * `StdinBuffer` flushes a sequence it could not finish inside its 50 ms window,
   * so a report split by a slow read arrives as `ESC [ < 35;6` and then as plain
   * characters, one per event. The head alone is not a keystroke worth keeping
   * and not a report any parser above accepts, so it is held here: the next
   * piece is appended, and the moment the two form a whole report the report is
   * delivered as one sequence — exactly as a terminal that was fast enough to
   * send it whole would have. A piece that cannot be the tail of a report means
   * the tail was lost, so the head is dropped and that piece is delivered on its
   * own: it is what the user typed.
   * @param sequence - one sequence from the input buffer.
   * @returns the sequence to deliver, or undefined while a half report waits.
   */
  private reassembleMouseReport(sequence: string): string | undefined {
    const pending = this.pendingMouseReport
    if (pending === undefined) {
      // A whole report passes through; a fragment waits for its tail.
      if (!SGR_MOUSE_HEAD.test(sequence)) return sequence
      this.holdMouseReport(sequence)
      return undefined
    }
    const joined = pending + sequence
    if (SGR_MOUSE_REPORT.test(joined)) {
      this.clearPendingMouseReport()
      return joined
    }
    if (SGR_MOUSE_HEAD.test(joined)) {
      this.holdMouseReport(joined)
      return undefined
    }
    // This piece cannot be the tail of that report: the tail was lost on the
    // way, so the fragment is given up on and the piece is delivered as it
    // arrived — it is a key the user typed, or the head of the next report.
    this.clearPendingMouseReport()
    if (!SGR_MOUSE_HEAD.test(sequence)) return sequence
    this.holdMouseReport(sequence)
    return undefined
  }

  /**
   * Keep a half report, and give up on it if no tail follows.
   *
   * A head longer than any report can be is dropped rather than buffered: it is
   * not a report in progress, and nothing above this layer could use it.
   */
  private holdMouseReport(partial: string): void {
    this.clearPendingMouseReport()
    if (partial.length > SGR_MOUSE_MAX_LENGTH) return
    this.pendingMouseReport = partial
    const timer = setTimeout(() => {
      this.pendingMouseReport = undefined
      this.pendingMouseTimer = undefined
    }, this.mouseReportTimeoutMs)
    // A window that stops with half a report on the wire must still be able to
    // exit: the timer is not a reason to keep the process alive.
    timer.unref()
    this.pendingMouseTimer = timer
  }

  /** Forget the half report and its timer. */
  private clearPendingMouseReport(): void {
    if (this.pendingMouseTimer !== undefined) clearTimeout(this.pendingMouseTimer)
    this.pendingMouseTimer = undefined
    this.pendingMouseReport = undefined
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
    this.write(`\u001b]0;${title.replace(TITLE_CONTROL, ' ')}\u0007`)
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
