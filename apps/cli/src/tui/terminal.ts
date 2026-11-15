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
import { writeSync } from 'node:fs'
import { formatProgramStatus, type ProgramStatus, type Terminal } from '@earendil-works/pi-tui'
import { InputParser } from './input/parse.js'

/** Push the Kitty keyboard protocol's disambiguate mode, keeping older flags. */
const PUSH_DISAMBIGUATE = '\u001b[>1u'

/** Pop it again, restoring whatever the terminal had before the client started. */
const POP_KEYBOARD_PROTOCOL = '\u001b[<u'

/**
 * Turn motion reporting off, keeping button motion.
 *
 * The renderer asks for all-motion tracking (`?1003`) on a terminal it does not
 * recognise as a multiplexer, which makes every pointer movement a report — a
 * trackpad sends hundreds a second. Nothing in this client needs bare motion but
 * the pointer shape on a divider, and that is not worth a flood that a slow read
 * can cut in half. Button motion (`?1002`) keeps clicks, drags, selections and
 * the wheel; this is the same trade a multiplexer makes.
 */
export const MOTION_OFF = '\u001b[?1003l'

/**
 * How long an incomplete sequence is held before it is handed back as keys.
 *
 * Only the *escape* needs this: a report whose escape was read on its own is
 * still recognised from its tail alone (see `InputParser`), so waiting longer
 * would buy nothing and cost the two things an escape must keep — it is the
 * Escape key, and `ESC x` within this window is the Alt chord the terminal sent.
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

/**
 * Give the terminal back, whatever happened.
 *
 * A client that dies without this leaves the terminal in the alternate screen
 * with mouse reporting on: the shell then receives the reports, echoes them as
 * text, and no amount of typing can be read. Writing it synchronously on the way
 * out is the only version that survives `process.exit` and an uncaught error.
 */
export const RESTORE_TERMINAL = [
  '\u001b[?1049l', // leave the alternate screen
  '\u001b[?1006l', '\u001b[?1004l', '\u001b[?1003l', '\u001b[?1002l', '\u001b[?1000l',
  '\u001b[?2004l', // bracketed paste off
  '\u001b[?25h', // show the cursor
  '\u001b[?7h', // autowrap back on
  POP_KEYBOARD_PROTOCOL,
].join('')

/** One guard: it owns the terminal from `install()` until the process ends. */
export interface TerminalGuard {
  /** Put the terminal back; the second and later calls do nothing. */
  restore(): void
  /** Restore on every way out: exit, a crash, and the signals a launcher sends. */
  install(): () => void
}

/**
 * Build a guard over one write function.
 *
 * The write is injected so a test can watch the bytes and the process can write
 * to its own file descriptor. The sequences are also what the renderer writes on
 * a graceful stop, so both paths are idempotent and safe in either order.
 * @param write - how to put bytes on the terminal's output.
 * @returns the guard.
 */
export function createTerminalGuard(write: (text: string) => void): TerminalGuard {
  let taken = false
  let restored = false
  const restore = (): void => {
    if (!taken || restored) return
    restored = true
    try {
      write(RESTORE_TERMINAL)
    } catch {
      // A closed tty has nothing to restore.
    }
  }
  return {
    restore,
    install() {
      taken = true
      restored = false
      const onExit = (): void => { restore() }
      const onError = (error: unknown): void => {
        restore()
        try {
          writeSync(2, `\n${String((error as Error)?.stack ?? error)}\n`)
        } catch {
          // best effort
        }
        process.exit(1)
      }
      const onSignal = (signal: NodeJS.Signals): void => {
        restore()
        process.exit(signal === 'SIGHUP' ? 129 : 143)
      }
      process.once('exit', onExit)
      process.once('uncaughtException', onError)
      process.once('unhandledRejection', onError)
      process.once('SIGHUP', onSignal)
      process.once('SIGTERM', onSignal)
      return restore
    },
  }
}

/**
 * The process's guard.
 *
 * `bun run start` is a launcher and an installed client is a shell script: both
 * can end the client with a signal, and neither restores the terminal for it.
 */
export function installTerminalGuard(): () => void {
  return createTerminalGuard(text => { writeSync(1, text) }).install()
}

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
    this.parser = new InputParser()
    this.rawData = (chunk: string | Buffer): void => {
      const text = String(chunk)
      this.trace?.(`raw ${JSON.stringify(text)}`)
      for (const piece of this.parser?.push(text) ?? []) this.deliver(piece)
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
  }

  stop(): void {
    if (this.rawData !== undefined) this.streams.input.off('data', this.rawData)
    this.rawData = undefined
    if (this.endData !== undefined) {
      this.streams.input.off('end', this.endData)
      this.streams.input.off('close', this.endData)
    }
    this.endData = undefined
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
