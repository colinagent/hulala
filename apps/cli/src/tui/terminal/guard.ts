/**
 * Give the terminal back on every way out.
 *
 * The guard is separate from the renderer's stop path on purpose: a crash, a
 * `process.exit`, and the signal a launcher sends all skip the renderer, and a
 * terminal left in the alternate screen with mouse reporting on is unusable
 * afterwards. The write is injected so a test can watch the bytes, and the
 * sequence itself lives in {@link RESTORE_TERMINAL} so there is one table.
 *
 * @module hulala-cli/tui/terminal/guard
 */
import { writeSync } from 'node:fs'
import { RESTORE_TERMINAL } from './modes.js'

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
 * @returns the restore function, for a caller that wants to put it back early.
 */
export function installTerminalGuard(): () => void {
  return createTerminalGuard(text => { writeSync(1, text) }).install()
}
