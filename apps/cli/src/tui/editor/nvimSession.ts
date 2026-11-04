/**
 * The editor column's process: Hulala's bundled Neovim, in a pty.
 *
 * Neovim runs as a real child so it keeps its own colours, keymaps, plugins and
 * file handling, exactly as it would in a plain terminal. Everything about
 * reading that pty back — VT parsing, styling, the render pass — is
 * `ScreenSession`; this module only decides what the editor is started with.
 *
 * Three choices matter here:
 *
 * - `.` is what opens the file tree: the vendored `snacks.nvim` replaces netrw
 *   and turns a directory buffer into its explorer, and netrw shows the same
 *   directory otherwise.
 * - No history: Neovim owns its own buffers and scrolling, so the column must
 *   not page independently of the cursor. `PageUp` stays Neovim's key.
 * - The mode is reported to the client through `HULALA_NVIM_MODE_FILE`, because
 *   `Ctrl-[` (byte-identical to `Esc`) is also the key that moves focus back to
 *   the composer, and Neovim must keep it while it has something to cancel.
 *
 * @module hulala-cli/tui/editor/nvimSession
 */
import type { PtyModule } from './pty.js'
import { ScreenSession } from '../pane/screenSession.js'

/**
 * Report Neovim's mode to the client through a small file.
 *
 * `Ctrl-[` is the same byte as `Esc`, so the TUI has to know whether the editor
 * still has something to cancel (insert, visual, command-line, operator-pending)
 * before it takes the key for focus switching. `--cmd` runs before the user's
 * config, which matters because Hulala's `init.lua` is written once and never
 * overwritten: an installation created by an older client has no such autocommand
 * of its own and still gets this one.
 */
const MODE_AUTOCMD = 'autocmd ModeChanged * lua local f = vim.env.HULALA_NVIM_MODE_FILE; if f and f ~= "" then pcall(vim.fn.writefile, {vim.v.event.new_mode}, f, "b") end'

export interface NvimSessionOptions {
  readonly pty: PtyModule
  /** Editor executable: the bundled Neovim, or `nvim` from PATH in dev. */
  readonly command: string
  /** Hulala's editor environment (isolated XDG homes, theme, plugin path). */
  readonly env: Record<string, string>
  /** Session working directory; also the editor's project root. */
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  /** Called after output has been parsed and the screen changed. */
  readonly onScreen: () => void
  /** Called once the editor process is gone. */
  readonly onExit: (exitCode: number) => void
}

/**
 * Start the editor on `.` in `cwd`.
 * @param options - pty module, executable, environment, size and callbacks.
 * @returns the running session.
 */
export function startNvimSession(options: NvimSessionOptions): ScreenSession {
  return ScreenSession.start({
    pty: options.pty,
    command: options.command,
    args: ['--cmd', MODE_AUTOCMD, '.'],
    env: options.env,
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
    onScreen: options.onScreen,
    onExit: options.onExit,
  })
}
