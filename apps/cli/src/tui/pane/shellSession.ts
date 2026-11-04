/**
 * The built-in terminal: the user's own shell in a pty.
 *
 * This is deliberately the user's shell and the user's environment. Unlike the
 * editor column — which runs Hulala's bundled Neovim with isolated `XDG_*`
 * homes so the user's config cannot change Hulala's editor — the terminal is
 * where their rc files, aliases, PATH and git credentials belong. Only the
 * size, the working directory and `TERM` are ours.
 *
 * History is kept (1000 lines) because a shell is read, not just typed into:
 * the column pages back through output that scrolled off, which an editor with
 * its own buffers never needs.
 *
 * No `-l` and no `-i`: a pty makes the shell interactive by itself, and a login
 * shell would re-source profile files that could replace the PATH Hulala was
 * started with.
 *
 * @module hulala-cli/tui/pane/shellSession
 */
import type { PtyModule } from '../editor/pty.js'
import { ScreenSession } from './screenSession.js'

/** Lines of scrollback the terminal column keeps. */
export const SHELL_SCROLLBACK = 1_000

export interface ShellSessionOptions {
  readonly pty: PtyModule
  /** Session working directory; the shell starts here. */
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  /** Overrides `$SHELL`; used by tests. */
  readonly shell?: string
  /** Extra environment on top of this process's own. */
  readonly env?: Record<string, string | undefined>
  readonly onScreen: () => void
  readonly onExit: (exitCode: number) => void
}

/**
 * Shell to run: the user's login shell, or POSIX `sh` when it is not set.
 * @param env - environment to read `SHELL` from.
 * @returns an absolute shell path.
 */
export function resolveShell(env: NodeJS.ProcessEnv = process.env): string {
  const shell = env.SHELL?.trim() ?? ''
  return shell === '' ? '/bin/sh' : shell
}

/**
 * Start the terminal column's shell.
 * @param options - pty module, working directory, size and callbacks.
 * @returns the running session, with history enabled.
 */
export function startShellSession(options: ShellSessionOptions): ScreenSession {
  return ScreenSession.start({
    pty: options.pty,
    command: options.shell ?? resolveShell(),
    args: [],
    env: options.env ?? {},
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
    scrollback: SHELL_SCROLLBACK,
    onScreen: options.onScreen,
    onExit: options.onExit,
  })
}
