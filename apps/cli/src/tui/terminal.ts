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
      if (this.inputHandler) this.inputHandler(sequence)
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
