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
// The predicates are the input decoder's, so this layer holds exactly the
// fragments the decoder could still complete. A bare `ESC` is the exception: it
// is also the Escape key, so it waits its own short window below.
import { isMouseReport, isMouseReportHead, isPaste, pasteIsIncomplete } from './input/keys.js'

/** Push the Kitty keyboard protocol's disambiguate mode, keeping older flags. */
const PUSH_DISAMBIGUATE = '\u001b[>1u'

/** Pop it again, restoring whatever the terminal had before the client started. */
const POP_KEYBOARD_PROTOCOL = '\u001b[<u'

/**
 * How long after an Escape the tail of a split report is still recognised.
 *
 * The sequence buffer flushes a lone `ESC` after ten milliseconds, so a report
 * whose escape was read separately arrives as the Escape key and then its tail.
 * The tail cannot be typed by anyone (it is `[<35;43;38M`), so inside this window
 * it is joined back to the escape that was already delivered and handed over as
 * the report it is.
 */
const ORPHAN_REPORT_WINDOW_MS = 500

/** A report without its escape: what the tail of a split one looks like. */
const ORPHAN_REPORT = /^\[<\d+;\d+;\d+[Mm]$/u

/**
 * The prefix of one, which arrives one character at a time.
 *
 * The sequence buffer emits anything that does not start with an escape as
 * single characters, so a tail whose escape was already delivered reaches this
 * adapter as `[`, `<`, `3`, … — each on its own — and is collected here.
 */
const ORPHAN_TAIL_HEAD = /^\[<?[\d;]*$/u

/** How long a possible report tail waits for its remaining characters. */
const ORPHAN_TAIL_TIMEOUT_MS = 120

/**
 * A bare `ESC`, held because it may be the head of a report.
 *
 * The exported {@link isMouseReportHead} deliberately excludes it: a bare escape
 * is also the Escape key, and only this adapter has the timing to decide.
 */
const REPORT_OR_ESCAPE_HEAD = /^\u001b(?:\[<?[\d;]*)?$/u

/**
 * How long a bare `ESC` waits for the `[` that would make it a report.
 *
 * It is also the Escape key, so this is a compromise, not a buffer: long enough
 * to catch a report split at the read boundary, short enough that the key does
 * not feel late. Everything longer than `ESC [` waits the full report timeout,
 * because no keyboard sequence begins that way.
 */
const ESCAPE_HEAD_TIMEOUT_MS = 30

/**
 * The largest paste the adapter buffers.
 *
 * A paste is delivered whole so the program can use its own paste semantics, but
 * a marker whose end never arrives must not become an unbounded buffer: past this
 * the bytes are delivered as they are and the frame decides what they were.
 */
const MAX_PASTE_BYTES = 8 * 1024 * 1024

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
  /**
   * A bracketed paste whose end marker has not arrived.
   *
   * A paste is opaque content of any length, so a read can end anywhere inside
   * it. Delivering half of it would paste the marker itself and then type the
   * rest as keys; the whole paste waits here instead.
   */
  private pendingPaste: string | undefined
  /** When an Escape was handed on, so a late report tail can be rejoined. */
  private escapeDeliveredAt = 0
  /** Characters of a report tail whose escape was already delivered. */
  private pendingOrphanTail: string | undefined
  private orphanTimer: ReturnType<typeof setTimeout> | undefined
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
      const kept = this.reassembleInput(sequence)
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
    this.clearOrphanTail()
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
  /**
   * Hold what cannot yet be decoded, in the order the terminal sends it.
   *
   * Two things can be incomplete: a paste that has not ended, and a mouse report
   * whose tail is in the next read. A paste is checked first: its content is
   * arbitrary bytes, so anything inside it that looks like a report is content.
   * @param sequence - what the sequence buffer delivered.
   * @returns the bytes to pass on, or undefined while waiting for the rest.
   */
  private reassembleInput(sequence: string): string | undefined {
    // The tail of a report whose escape was already delivered: joining the two
    // back together is what keeps `<35;43;38M` out of a buffer.
    if (this.escapeDeliveredAt !== 0 && Date.now() - this.escapeDeliveredAt <= ORPHAN_REPORT_WINDOW_MS) {
      const joined = (this.pendingOrphanTail ?? '') + sequence
      if (ORPHAN_REPORT.test(joined)) {
        this.clearOrphanTail()
        return `\u001b${joined}`
      }
      if (ORPHAN_TAIL_HEAD.test(joined)) {
        this.pendingOrphanTail = joined
        this.armOrphanTail()
        return undefined
      }
      // Not the tail after all: give its characters back, in the order they were
      // typed, and treat this sequence normally.
      if (this.pendingOrphanTail !== undefined) {
        this.clearOrphanTail()
        this.inputHandler?.(joined.slice(0, joined.length - sequence.length))
      }
    }
    if (this.pendingPaste !== undefined) {
      const joined = this.pendingPaste + sequence
      if (pasteIsIncomplete(joined)) {
        if (joined.length > MAX_PASTE_BYTES) {
          // Not a paste we can hold: give up on the marker and deliver the text,
          // which is what a terminal would have done with the bytes anyway.
          this.pendingPaste = undefined
          return joined
        }
        this.pendingPaste = joined
        return undefined
      }
      this.pendingPaste = undefined
      return isPaste(joined) ? joined : undefined
    }
    if (pasteIsIncomplete(sequence)) {
      if (sequence.length > MAX_PASTE_BYTES) return sequence
      this.pendingPaste = sequence
      return undefined
    }
    return this.reassembleMouseReport(sequence)
  }

  /** Hold a possible report tail until it completes or the window closes. */
  private armOrphanTail(): void {
    if (this.orphanTimer !== undefined) clearTimeout(this.orphanTimer)
    this.orphanTimer = setTimeout(() => {
      this.orphanTimer = undefined
      const held = this.pendingOrphanTail
      this.pendingOrphanTail = undefined
      // A person typed it: it is text like any other.
      if (held !== undefined) this.inputHandler?.(held)
    }, ORPHAN_TAIL_TIMEOUT_MS)
  }

  private clearOrphanTail(): void {
    if (this.orphanTimer !== undefined) clearTimeout(this.orphanTimer)
    this.orphanTimer = undefined
    this.pendingOrphanTail = undefined
  }

  private reassembleMouseReport(sequence: string): string | undefined {
    const pending = this.pendingMouseReport
    if (pending === undefined) {
      // A whole report passes through; a fragment waits for its tail, and so
      // does a bare escape, which may be one.
      if (!isMouseReportHead(sequence) && !REPORT_OR_ESCAPE_HEAD.test(sequence)) return sequence
      if (sequence === '\u001b') this.escapeDeliveredAt = 0
      this.holdMouseReport(sequence)
      return undefined
    }
    const joined = pending + sequence
    if (isMouseReport(joined)) {
      this.clearPendingMouseReport()
      this.escapeDeliveredAt = 0
      return joined
    }
    if (isMouseReportHead(joined)) {
      this.holdMouseReport(joined)
      return undefined
    }
    // This piece cannot be the tail of that report: the tail was lost on the
    // way, so the fragment is given up on and the piece is delivered as it
    // arrived — it is a key the user typed, or the head of the next report.
    this.clearPendingMouseReport()
    // A held `ESC` is a key too, and it comes first: dropping it would swallow
    // one Escape whenever two of them, or an Escape and a key, arrive together.
    if (pending === '\u001b') {
      this.escapeDeliveredAt = Date.now()
      this.inputHandler?.('\u001b')
    }
    if (!isMouseReportHead(sequence)) return sequence
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
    // A held `ESC` is given back as the key it also is when no report follows.
    const escape = partial === '\u001b'
    const timer = setTimeout(() => {
      this.pendingMouseReport = undefined
      this.pendingMouseTimer = undefined
      // A fragment that has already named a report button (`ESC [ < …`) is a
      // report whose tail was lost: it is dropped, and no key is invented.
      if (partial.includes('<')) return
      // Otherwise the escape was a key. `ESC [` alone is far more often Escape
      // then a bracket than a report, so the bracket is given back too; keeping
      // the moment it was handed on lets a tail still in flight be rejoined.
      this.escapeDeliveredAt = Date.now()
      this.inputHandler?.('\u001b')
      if (partial === '\u001b[') this.inputHandler?.('[')
    }, escape ? Math.min(this.mouseReportTimeoutMs, ESCAPE_HEAD_TIMEOUT_MS) : Math.min(this.mouseReportTimeoutMs, ORPHAN_TAIL_TIMEOUT_MS))
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
