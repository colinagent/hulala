/**
 * Injectable terminal adapter for pi-tui.
 *
 * `ProcessTerminal` hard-codes `process.stdin/stdout`, which makes the client
 * untestable with injected streams. This minimal `Terminal` implementation owns
 * raw mode, stdin framing (via {@link InputParser}), resize notifications, and
 * the escape-sequence surface pi-tui's renderer calls.
 *
 * It does ask for the Kitty keyboard protocol's *disambiguate* mode, because a
 * macOS terminal will not report a Command chord any other way — and Command is
 * what the frame's divider keys are bound to. Legacy keys keep working: the
 * renderer matches both spellings, and the column programs get the legacy bytes
 * back through `pane/legacyKeys.ts`. Nothing is flipped in pi-tui's own parser
 * state (`kittyProtocolActive` stays false), so a terminal that ignores the
 * request reads exactly like it always did.
 *
 * Framing is ours, not the renderer's. pi-tui's own buffer splits a chunk into
 * "sequences" for a TUI, which is right for a key and wrong for a program's
 * bytes: a report whose escape was read on its own comes back as one character
 * per event and ends up typed into whatever has the keyboard. `InputParser`
 * keeps the buffer instead, so a report is delivered whole however the kernel
 * cut it, and only a prefix that never completes is dropped.
 *
 * @module hulala-cli/tui/terminal
 */
import { formatProgramStatus, type ProgramStatus, type Terminal } from '@earendil-works/pi-tui'
import { InputParser } from './input/parse.js'

/** Push the Kitty keyboard protocol's disambiguate mode, keeping older flags. */
const PUSH_DISAMBIGUATE = '\u001b[>1u'

/** Pop it again, restoring whatever the terminal had before the client started. */
const POP_KEYBOARD_PROTOCOL = '\u001b[<u'

/**
 * How long an incomplete sequence is held before it is handed back as keys.
 *
 * Only the *escape* needs this: a report whose escape was read on its own is
 * still recognised from its tail alone (see `InputParser`), so waiting longer
 * would buy nothing and cost the two things an escape must keep — it is the
 * Escape key, and `ESC x` within this window is the Alt chord the terminal sent.
 * A human pressing Escape and then a key slower than this gets two keys.
 */
const HOLD_TIMEOUT_MS = 25

/**
 * How long a report's head waits for its tail.
 *
 * A report is one gesture, so its halves may come a read apart and nothing about
 * the first half can be given back as keys. A second is far longer than any read
 * gap and short enough that a stream which lost the tail does not hold the next
 * keystroke's bytes forever.
 */
const REPORT_HOLD_MS = 1_000

/** The head of a report, whose tail has not arrived. */
const REPORT_HEAD = /^\u001b?\[<[\d;]*$/u

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
  /**
   * How long an incomplete sequence waits for its remainder.
   *
   * A lone escape may be the Escape key or the head of a report; `ESC [` may be
   * Alt-`[` or the start of a CSI. Nothing can tell them apart but time.
   */
  readonly holdTimeoutMs?: number
  /** How long a report's head waits for its tail; tests shorten it. */
  readonly reportHoldTimeoutMs?: number
  /**
   * Every chunk as the terminal read it, and every sequence handed on.
   *
   * Diagnostics only: a report that arrives in pieces is invisible in the
   * rendered screen, so `HULALA_DEBUG_CLIENT` records both sides of this
   * adapter and a missing escape shows up as `raw` without `delivered`.
   */
  readonly trace?: (line: string) => void
}

export class StreamTerminal implements Terminal {
  private readonly streams: TerminalStreams
  private readonly holdTimeoutMs: number
  private readonly reportHoldTimeoutMs: number
  private readonly trace: ((line: string) => void) | undefined
  private inputHandler: ((data: string) => void) | undefined
  private resizeHandler: (() => void) | undefined
  /** The one place input is framed; see {@link InputParser}. */
  private parser: InputParser | undefined
  private wasRaw = false
  private rawData: ((chunk: string | Buffer) => void) | undefined
  private detachResize: (() => void) | undefined
  private holdTimer: ReturnType<typeof setTimeout> | undefined

  constructor(streams: TerminalStreams, options: TerminalOptions = {}) {
    this.streams = streams
    this.holdTimeoutMs = options.holdTimeoutMs ?? HOLD_TIMEOUT_MS
    this.reportHoldTimeoutMs = options.reportHoldTimeoutMs ?? REPORT_HOLD_MS
    this.trace = options.trace
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

    if (process.env.HULALA_TRACE_START !== undefined) console.error('[start] terminal starting')
    this.parser = new InputParser()
    this.rawData = (chunk: string | Buffer): void => {
      const text = String(chunk)
      this.trace?.(`raw ${JSON.stringify(text)}`)
      for (const piece of this.parser?.push(text) ?? []) this.deliver(piece)
      this.armHold()
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
    this.clearHold()
    this.parser = undefined
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

  /** Hand one complete piece to the frame, and record which one it was. */
  private deliver(piece: string): void {
    this.trace?.(`piece ${JSON.stringify(piece)}`)
    this.inputHandler?.(piece)
  }

  /**
   * Give held bytes back once nothing more arrives for them.
   *
   * The parser holds a prefix that could still grow — a lone escape, half a CSI,
   * `[<35;` — and only time can say whether the rest is coming. When it does not,
   * the escape becomes the Escape key, an Alt chord is delivered as it stands,
   * and a report fragment is dropped: half a report is never typing.
   */
  private armHold(): void {
    this.clearHold()
    const pending = this.parser?.pending() ?? ''
    if (pending === '') return
    const wait = REPORT_HEAD.test(pending) ? this.reportHoldTimeoutMs : this.holdTimeoutMs
    this.holdTimer = setTimeout(() => {
      this.holdTimer = undefined
      if (this.parser === undefined) return
      for (const piece of this.parser.drain()) this.deliver(piece)
    }, wait)
  }

  private clearHold(): void {
    if (this.holdTimer !== undefined) clearTimeout(this.holdTimer)
    this.holdTimer = undefined
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
    this.ownTitle = title
    this.write(this.titleSequence(title))
  }

  /**
   * Show a program's title without taking the window's own title away.
   *
   * A program in a column may name the window (Neovim's `titlestring`), but the
   * client's title names the Session; while the column has the keyboard its title
   * is the more useful one, and clearing it puts the client's back.
   * @param title - the program's title, or undefined to restore the client's.
   */
  setOverlayTitle(title: string | undefined): void {
    const next = title ?? this.ownTitle
    if (next === undefined) return
    this.write(this.titleSequence(next))
  }

  private ownTitle: string | undefined

  private titleSequence(title: string): string {
    return `\u001b]0;${title.replace(TITLE_CONTROL, ' ')}\u0007`
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
