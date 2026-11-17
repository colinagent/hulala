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
 * back through `input/keys.ts`'s pty projection. Nothing is flipped in pi-tui's
 * own parser state (`kittyProtocolActive` stays false), so a terminal that
 * ignores the request reads exactly like it always did.
 *
 * The adapter is also the only writer of terminal modes: it filters the enable
 * sequences of modes the client does not consume, so a renderer cannot switch
 * them on behind the frame's back. See `terminal/modes.ts`.
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
import { filterUnusedModes, POP_KEYBOARD_PROTOCOL, PUSH_DISAMBIGUATE } from './terminal/modes.js'
import {
  DEFAULT_ESCAPE_TIMEOUT_MS,
  DEFAULT_ORPHAN_WINDOW_MS,
  DEFAULT_REPORT_RUN_MS,
  DEFAULT_REPORT_TIMEOUT_MS,
  LAG_INTERVAL_MS,
  READ_GAP_MS,
  SLOW_WRITE_MS,
} from './terminal/timing.js'

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
  /**
   * Where the frame is painted, and what a queued surface offers on top of it.
   *
   * A real terminal is painted through `terminal/writer.ts`, whose surface also
   * has `flushSync` and `drain`: the first is what an exit sequence calls before
   * it becomes the last write, the second is what a hand-off waits for before a
   * successor paints the same screen. An injected stream (a test, a pipe) has
   * neither, and a direct write is exactly right for it.
   */
  output: {
    write(data: string): void
    isTTY?: boolean
    columns?: number
    rows?: number
    /** The descriptor a buffered surface writes to; absent means paint directly. */
    fd?: number
    flushSync?: () => void
    drain?: () => Promise<void>
    on?: (event: string, listener: () => void) => void
    removeListener?: (event: string, listener: () => void) => void
  }
}

/** Timing knobs a test can shorten; the client always takes the defaults. */
export interface TerminalOptions {
  /**
   * How long an incomplete sequence waits for its remainder.
   *
   * A lone escape may be the Escape key or the head of a report; `ESC [` may be
   * Alt-`[` or the start of a CSI. Nothing can tell them apart but time.
   */
  readonly escapeTimeoutMs?: number
  /** How long a report's head waits for its tail; tests shorten it. */
  readonly reportTimeoutMs?: number
  /** How long after a delivered Escape its stripped tail can be rejoined. */
  readonly orphanWindowMs?: number
  /** How long after a delivered report a damaged tail is still report traffic. */
  readonly reportRunMs?: number
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
  private readonly escapeTimeoutMs: number
  private readonly reportTimeoutMs: number
  private readonly orphanWindowMs: number
  private readonly reportRunMs: number
  private readonly trace: ((line: string) => void) | undefined
  private inputHandler: ((data: string) => void) | undefined
  private resizeHandler: (() => void) | undefined
  /** The terminal went away (the window was closed or the pty was lost). */
  private hangupHandler: (() => void) | undefined
  private endData: (() => void) | undefined
  private hungUp = false
  /** The one place input is framed; see {@link InputParser}. */
  private parser: InputParser | undefined
  private wasRaw = false
  private rawData: ((chunk: string | Buffer) => void) | undefined
  private detachResize: (() => void) | undefined
  private holdTimer: ReturnType<typeof setTimeout> | undefined
  /** Read gap and loop lag, measured only when tracing: they date a stall. */
  private lastReadAt = 0
  private lagTimer: ReturnType<typeof setInterval> | undefined
  private lagAt = 0

  constructor(streams: TerminalStreams, options: TerminalOptions = {}) {
    this.streams = streams
    this.escapeTimeoutMs = options.escapeTimeoutMs ?? DEFAULT_ESCAPE_TIMEOUT_MS
    this.reportTimeoutMs = options.reportTimeoutMs ?? DEFAULT_REPORT_TIMEOUT_MS
    this.orphanWindowMs = options.orphanWindowMs ?? DEFAULT_ORPHAN_WINDOW_MS
    this.reportRunMs = options.reportRunMs ?? DEFAULT_REPORT_RUN_MS
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

  /**
   * Hear the terminal going away.
   *
   * A window that was closed is not a window that is still there: its stdin ends,
   * and a client that ignores that keeps a Host connection and a forward open for
   * as long as the machine is up. Stale clients stacked up on one Host are then
   * indistinguishable from the one the user is typing into — one of them runs an
   * older build.
   * @param handler - called once when the terminal's input ends.
   */
  onHangup(handler: () => void): void {
    this.hangupHandler = handler
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
    this.parser = new InputParser({
      orphanWindowMs: this.orphanWindowMs,
      reportRunMs: this.reportRunMs,
      now: () => Date.now(),
    })
    this.rawData = (chunk: string | Buffer): void => {
      const text = String(chunk)
      this.trace?.(`raw ${JSON.stringify(text)}`)
      if (this.trace !== undefined) this.traceReadGap()
      for (const piece of this.parser?.push(text) ?? []) this.deliver(piece)
      // A tail whose escape was already handed on is dropped, never typed; the
      // trace keeps the evidence for a machine whose read boundaries change.
      for (const dropped of this.parser?.takeDrops() ?? []) this.trace?.(`drop ${JSON.stringify(dropped)}`)
      // A report that lost its introducer is the other half of that evidence.
      for (const damaged of this.parser?.takeDamaged() ?? []) this.trace?.(`damaged ${JSON.stringify(damaged)}`)
      this.armHold()
    }
    input.on('data', this.rawData)
    this.endData = () => {
      // `end` and `close` can both arrive, and one window is still one hangup.
      if (this.hungUp) return
      this.hungUp = true
      this.hangupHandler?.()
    }
    input.on('end', this.endData)
    input.on('close', this.endData)

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
    this.startLagProbe()
  }

  stop(): void {
    if (this.rawData !== undefined) this.streams.input.off('data', this.rawData)
    this.rawData = undefined
    // `off('data')` alone leaves stdin in flowing mode: Node keeps draining the
    // fd and discards the bytes, which would steal input from a successor that
    // inherited the same tty. A restart hands that terminal to a child process,
    // so this side must stop reading altogether.
    if ('pause' in this.streams.input && typeof this.streams.input.pause === 'function') {
      this.streams.input.pause()
    }
    if (this.endData !== undefined) {
      this.streams.input.off('end', this.endData)
      this.streams.input.off('close', this.endData)
    }
    this.endData = undefined
    this.clearHold()
    this.stopLagProbe()
    this.parser = undefined
    this.detachResize?.()
    this.detachResize = undefined
    // Pop the keyboard mode before the paste mode: the terminal must go back to
    // the encoding the shell expects.
    this.write(POP_KEYBOARD_PROTOCOL)
    this.write('\u001b[?2004l')
    // A queued surface still holds those two sequences, and the shell that comes
    // next must not paint over them.
    this.flushSync()
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
   * Forget a half-received sequence, because the terminal cannot be trusted.
   *
   * A window that slept, or a connection that was rebuilt, can leave a fragment
   * from a stream that no longer exists. Draining it would hand the fragment
   * back as keys — `[<35;` typed into whatever has the keyboard — so it is
   * dropped, and the frame repaints from scratch on its own schedule.
   * @param reason - what invalidated the stream, for the trace.
   */
  resetInput(reason: string): void {
    this.parser?.reset()
    this.clearHold()
    const dropped = this.parser?.takeDamaged() ?? []
    if (dropped.length === 0) this.trace?.(`reset ${reason}`)
    for (const fragment of dropped) this.trace?.(`reset ${reason} dropped ${JSON.stringify(fragment)}`)
  }

  /**
   * Write whatever is queued, before the terminal is handed back.
   *
   * The guard writes the restore sequence with a synchronous call that bypasses
   * the queue, so the queue has to be empty first or a frame would land after
   * the screen was given back. A surface that paints directly has nothing to do.
   */
  flushSync(): void {
    this.streams.output.flushSync?.()
  }

  /**
   * Resolve once the frame has reached the terminal, or once waiting is pointless.
   *
   * A restart starts a process that inherits this terminal, and two writers on
   * one screen produce neither of the two frames. The queue is drained before the
   * successor starts; a terminal that never takes the bytes must not hold the
   * window open, so the wait is bounded.
   * @param deadlineMs - how long to wait for a terminal that stopped reading.
   */
  async drainOutput(deadlineMs = 500): Promise<void> {
    const drain = this.streams.output.drain
    if (drain === undefined) return
    await Promise.race([
      drain(),
      new Promise<void>(resolve => { setTimeout(resolve, deadlineMs).unref?.() }),
    ])
  }

  /**
   * Note the gap between reads, when one is long enough to mean something.
   *
   * Input that stops for seconds is the one local fact that dates a stall: a
   * frozen loop, a sleeping machine and a reconnect all look the same in the
   * frame, and the trace needs to tell them apart.
   */
  private traceReadGap(): void {
    const now = Date.now()
    const gap = this.lastReadAt === 0 ? 0 : now - this.lastReadAt
    this.lastReadAt = now
    if (gap > READ_GAP_MS) this.trace?.(`gap ${String(gap)}ms`)
  }

  /**
   * Measure the event loop's own delay while tracing.
   *
   * A synchronous write to a terminal that stopped reading blocks the loop, and
   * that is the moment input stops being read — the chain that ends in a tty
   * queue full of truncated reports. A timer that fires late is the cheapest
   * proof of it, and it costs nothing when tracing is off.
   */
  private startLagProbe(): void {
    if (this.trace === undefined) return
    this.lagAt = Date.now()
    this.lagTimer = setInterval(() => {
      const now = Date.now()
      const lag = now - this.lagAt - LAG_INTERVAL_MS
      this.lagAt = now
      if (lag > SLOW_WRITE_MS) this.trace?.(`lag ${String(lag)}ms`)
    }, LAG_INTERVAL_MS)
    this.lagTimer.unref?.()
  }

  private stopLagProbe(): void {
    if (this.lagTimer !== undefined) clearInterval(this.lagTimer)
    this.lagTimer = undefined
    this.lastReadAt = 0
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
    const kind = this.parser?.pendingKind() ?? 'none'
    // A paste is not ambiguous: its start marker already said what it is, and
    // the parser will hold it until the end marker. Giving it a timer would only
    // hand an unfinished paste back as keys.
    if (kind === 'none' || kind === 'paste') return
    const wait = kind === 'report' ? this.reportTimeoutMs : this.escapeTimeoutMs
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
    // The only writer of terminal modes: a renderer may ask for all-motion or
    // focus reports, and neither is consumed here. Filtering on the way out is
    // what makes that a rule instead of a convention (see `terminal/modes.ts`).
    const text = filterUnusedModes(data)
    if (this.trace === undefined) {
      this.streams.output.write(text)
      return
    }
    // A tty write is synchronous in Node, so a terminal that stopped reading
    // blocks here. The measurement is what turns "the frame froze" into a
    // timestamped fact.
    const started = performance.now()
    this.streams.output.write(text)
    const spent = performance.now() - started
    if (spent >= SLOW_WRITE_MS) this.trace(`write ${String(Math.round(spent))}ms ${String(text.length)}B`)
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
