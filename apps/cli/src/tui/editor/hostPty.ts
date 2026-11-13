/**
 * The terminal column's pty, resolved to a Host terminal instead of a local one.
 *
 * A column renders bytes. It does not care whether the process is a `node-pty`
 * child of this process or a Session-owned shell on a Host reached over
 * loopback or SSH, so this adapter keeps the {@link PtyModule} shape: `spawn`
 * hands back a handle at once, and the create/attach round trip fills in behind
 * it. Anything typed before the attachment opens is queued, and frames arrive
 * as the same `snapshot`/`output` byte stream the local VT already expects.
 *
 * The process belongs to the Host. `kill()` also closes the identity, because a
 * column the user closed should end its shell rather than leave an orphan
 * running for the next window to find; disposing the attachment alone would
 * only detach.
 *
 * @module hulala-cli/tui/editor/hostPty
 */
import type { PtyModule, PtyProcess, PtySpawnOptions } from './pty.js'
import type { HostTerminalAttachment, HostTerminals } from '../data/remote.js'

/**
 * Bytes of unacknowledged input the adapter will keep on the wire.
 *
 * The Host refuses a command that would exceed `maxInputBytes` (64 KiB by
 * default) of unacknowledged input, so staying well under it turns a refusal
 * into a short delay instead of a lost keystroke.
 */
const MAX_UNACKED_BYTES = 32 * 1024

/** Input held while the attachment is still opening or the Host is behind. */
const MAX_QUEUED_INPUT = 512 * 1024

export interface HostPtyOptions {
  /** Session-owned terminals the Host exposes. */
  readonly terminal: HostTerminals
  /** Session whose working directory the shell inherits. */
  readonly sessionId: string
  /** A create or attach failure, for the column to report instead of a blank pane. */
  readonly onFailure?: (message: string) => void
}

/** Where the column's program runs; the shell profile stays the Host's choice. */
export interface HostPtySpawnOptions extends PtySpawnOptions {
  /** Explicit shell profile from {@link HostTerminals.shells}; omitted means Host default. */
  readonly shellPath?: string
}

/**
 * Build a pty module backed by Host terminals.
 *
 * `spawn` ignores the local `file`, `args` and `env`: the shell, its arguments
 * and its environment belong to the Host's execution world, and a client path
 * would be meaningless there.
 * @param options - the Host terminal face plus the Session that owns the process.
 * @returns a module the column kernel can use exactly like a local pty.
 */
export function hostPty(options: HostPtyOptions): PtyModule {
  return {
    spawn(_file, _args, spawnOptions) {
      return new HostPtyProcess(options, spawnOptions as HostPtySpawnOptions)
    },
  }
}

/** One Host terminal identity, presented as a pty the column can drive. */
class HostPtyProcess implements PtyProcess {
  /** The Host mints the real identity; this value is only unique per column. */
  readonly pid = 0

  private readonly options: HostPtyOptions
  private readonly id: string
  private readonly cols: number
  private readonly rows: number
  private readonly shellPath: string | undefined
  private handler: ((data: string) => void) | undefined
  private exit: ((event: { exitCode: number }) => void) | undefined
  private attachment: HostTerminalAttachment | undefined
  private sequence = 0
  private unacked = 0
  private readonly sent = new Map<number, number>()
  private queued = ''
  private pendingResize: { cols: number; rows: number } | undefined
  private terminated = false
  private killed = false

  constructor(options: HostPtyOptions, spawnOptions: HostPtySpawnOptions) {
    this.options = options
    this.id = crypto.randomUUID()
    this.cols = spawnOptions.cols
    this.rows = spawnOptions.rows
    this.shellPath = spawnOptions.shellPath
    void this.open()
  }

  /** Create the identity, then attach; the column already holds this handle. */
  private async open(): Promise<void> {
    try {
      await this.options.terminal.create(this.options.sessionId, {
        id: this.id,
        cols: this.cols,
        rows: this.rows,
        ...(this.shellPath === undefined ? {} : { shellPath: this.shellPath }),
      })
      if (this.killed) {
        await this.options.terminal.close(this.options.sessionId, this.id).catch(() => undefined)
        return
      }
      const attachment = this.options.terminal.attach(this.options.sessionId, this.id)
      this.attachment = attachment
      attachment.onFrame(frame => this.receive(frame))
      if (this.pendingResize !== undefined) {
        const resize = this.pendingResize
        this.pendingResize = undefined
        this.writeCommand(resize.cols, resize.rows)
      }
      this.flush()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      this.options.onFailure?.(message)
      // A failed create still has to settle the column: it awaited this handle.
      this.handler?.(`\r\n${message}\r\n`)
      this.finish(-1)
    }
  }

  /** Translate one Host frame into the byte and exit events a pty delivers. */
  private receive(frame: Parameters<Parameters<HostTerminalAttachment['onFrame']>[0]>[0]): void {
    switch (frame.type) {
      case 'snapshot':
        // The snapshot is a complete screen, not a delta: clear first so a
        // reattach over a live column does not interleave two paints.
        this.handler?.(`\u001b[0m\u001b[H\u001b[2J${frame.screen}`)
        break
      case 'output':
        this.handler?.(frame.data)
        break
      case 'ack': {
        const bytes = this.sent.get(frame.sequence)
        if (bytes !== undefined) {
          this.sent.delete(frame.sequence)
          this.unacked = Math.max(0, this.unacked - bytes)
        }
        if (frame.refusal !== undefined) {
          this.options.onFailure?.(frame.refusal === 'read-only'
            ? 'The Host reports this terminal as read-only.'
            : 'The Host reports this terminal as not running.')
        }
        this.flush()
        break
      }
      case 'state':
        if (frame.info.state !== 'running') this.finish(frame.info.exitCode ?? -1)
        break
      default:
        break
    }
  }

  onData(handler: (data: string) => void): void {
    this.handler = handler
  }

  onExit(handler: (event: { exitCode: number }) => void): void {
    this.exit = handler
    if (this.terminated) handler({ exitCode: this.lastExit })
  }

  write(data: string): void {
    if (this.terminated) return
    if (this.attachment === undefined) {
      this.enqueue(data)
      return
    }
    if (this.unacked + data.length > MAX_UNACKED_BYTES) {
      this.enqueue(data)
      return
    }
    this.sendWrite(data)
  }

  resize(cols: number, rows: number): void {
    if (this.terminated) return
    if (this.attachment === undefined) {
      this.pendingResize = { cols, rows }
      return
    }
    this.writeCommand(cols, rows)
  }

  kill(): void {
    if (this.killed) return
    this.killed = true
    this.terminated = true
    this.attachment?.dispose()
    this.attachment = undefined
    void this.options.terminal.close(this.options.sessionId, this.id).catch(() => undefined)
  }

  private lastExit = -1

  /** Report the end of the process exactly once, however it ended. */
  private finish(exitCode: number): void {
    if (this.terminated) return
    this.terminated = true
    this.lastExit = exitCode
    this.attachment?.dispose()
    this.attachment = undefined
    this.exit?.({ exitCode })
  }

  private enqueue(data: string): void {
    if (this.queued.length + data.length > MAX_QUEUED_INPUT) return
    this.queued += data
  }

  /** Release held input once the wire has room again. */
  private flush(): void {
    if (this.attachment === undefined || this.queued === '') return
    const data = this.queued
    this.queued = ''
    if (this.unacked + data.length > MAX_UNACKED_BYTES) {
      this.queued = data
      return
    }
    this.sendWrite(data)
  }

  private sendWrite(data: string): void {
    if (this.attachment === undefined) return
    const sequence = this.sequence + 1
    this.sequence = sequence
    this.unacked += data.length
    this.sent.set(sequence, data.length)
    this.attachment.send({ type: 'write', sequence, data })
  }

  private writeCommand(cols: number, rows: number): void {
    if (this.attachment === undefined) return
    const sequence = this.sequence + 1
    this.sequence = sequence
    this.attachment.send({ type: 'resize', sequence, cols, rows })
  }
}
