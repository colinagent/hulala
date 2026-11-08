/**
 * Sidebar focus policy: which column `Ctrl-]` reopens and who owns `Ctrl-[`.
 *
 * The sidebar is one column beside the conversation, showing either the shell
 * (`Ctrl-T`) or Neovim (`Ctrl-D`). The two processes are independent and both
 * stay alive while hidden, so switching columns is not closing anything.
 *
 * `Ctrl-[` is the same byte as `Esc`, so it cannot simply be taken away from the
 * sidebar: Neovim needs it in every mode except normal, and a full-screen
 * program in the terminal (a pager, `fzf`) needs it too. Only when the program
 * has nothing to cancel does the key mean "back to the composer".
 *
 * @module hulala-cli/tui/pane/focus
 */

/** The two columns that can sit beside the transcript; at most one at a time. */
export type PaneKind = 'terminal' | 'editor'

/** Both columns, in the order `Ctrl-]` may reopen them. */
export const PANE_KINDS: readonly PaneKind[] = ['editor', 'terminal']

/** Everything the client knows about how the focused program uses `Esc`. */
export interface EscapeOwnership {
  /** Neovim's current mode (`'n'`, `'i'`, ...), or undefined before it reports. */
  readonly editorMode: string | undefined
  /** The terminal is on the alternate screen, i.e. a full-screen program owns it. */
  readonly alternateScreen: boolean
}

/** Where focus is, as far as the sidebar is concerned. */
export interface SidebarFocus {
  /** The column currently painted in the sidebar, if any. */
  readonly visible: PaneKind | undefined
  /** The column shown most recently, kept after the sidebar is closed. */
  readonly last: PaneKind | undefined
}

/**
 * Whether the focused column keeps `Ctrl-[` instead of it moving focus back to
 * the composer. Neovim reports its mode through `ModeChanged`, and a terminal on
 * the alternate screen is running a program with its own use for `Esc`.
 * @param kind - the focused column.
 * @param state - its mode or screen, read at key time.
 * @returns true when the key belongs to the program.
 */
export function paneOwnsEscape(kind: PaneKind, state: EscapeOwnership): boolean {
  // A missing mode is Neovim's startup state, which is normal mode.
  if (kind === 'editor') return state.editorMode !== undefined && state.editorMode !== 'n'
  return state.alternateScreen
}

/**
 * The column `Ctrl-]` should focus. The visible sidebar wins; a closed one is
 * reopened only while its process is still alive, so the key never starts a
 * program on its own.
 * @param focus - the sidebar state.
 * @param has - whether a column still has a live process.
 * @returns the column to focus, or undefined when there is nothing to switch to.
 */
export function paneForSwitch(focus: SidebarFocus, has: (kind: PaneKind) => boolean): PaneKind | undefined {
  if (focus.visible !== undefined) return focus.visible
  if (focus.last !== undefined && has(focus.last)) return focus.last
  return PANE_KINDS.find(kind => has(kind))
}
