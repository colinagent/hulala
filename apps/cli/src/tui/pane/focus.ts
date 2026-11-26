/**
 * Sidebar focus policy: which column a panel key reopens, and who owns `Esc`.
 *
 * The sidebar is one column beside the conversation, showing either the shell
 * (`Ctrl-T`) or Neovim (`Ctrl-G`). The two processes are independent and both
 * stay alive while hidden, so switching columns is not closing anything.
 *
 * The keyboard comes back with any panel key (`Ctrl-D`, `Ctrl-F`, `Ctrl-G`, or
 * `Ctrl-T` for the other column), which is what lets a program that keeps `Esc`
 * still be left. `Esc` is the other way out
 * and the one that needs a rule: Neovim needs it in every mode except normal,
 * and a full-screen program in the terminal (a pager, `fzf`) needs it too. Only
 * when the program has nothing to cancel does `Esc` mean "back to the
 * composer".
 *
 * @module hulala-cli/tui/pane/focus
 */

/** The two columns that can sit beside the transcript; at most one at a time. */
export type PaneKind = 'terminal' | 'editor'

/** Everything the client knows about how the focused program uses `Esc`. */
export interface EscapeOwnership {
  /** Neovim's current mode (`'n'`, `'i'`, ...), or undefined before it reports. */
  readonly editorMode: string | undefined
  /** The terminal is on the alternate screen, i.e. a full-screen program owns it. */
  readonly alternateScreen: boolean
}

/**
 * Whether the focused column keeps `Esc` instead of it moving focus back to
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
 * What a surface that holds the keyboard does with the keystrokes.
 *
 * `command` means the keys are an instruction — a vim motion, a shortcut, a list
 * row, a yes/no — so a Chinese input method must not be allowed to turn them
 * into a composition. `text` means the keys are the user's own writing, so the
 * input source is theirs and the client leaves it alone.
 */
export type ImePolicy = 'text' | 'command'

/**
 * The policy a component declares, defaulting to `text`.
 *
 * Components carry this as a plain field rather than through a constructor, so a
 * surface whose keys change meaning over time — Neovim, which reads text in
 * insert mode and commands everywhere else — can flip it while it owns the
 * keyboard and ask the terminal to re-read it.
 * @param component - the component that now holds the keyboard.
 * @returns the declared policy, or `text` when nothing is declared.
 */
export function imePolicyOf(component: object): ImePolicy {
  const declared = (component as { imePolicy?: unknown }).imePolicy
  return declared === 'command' ? 'command' : 'text'
}

/**
 * Whether a Neovim mode is one where the user is writing text.
 *
 * `ModeChanged` reports compound names (`ic`, `Rc`, `ix`), so the prefix is what
 * matters: insert and replace take text, select mode replaces it. Everything
 * else — normal, visual, command-line, terminal — is a command surface. A mode
 * that has not been reported yet is Neovim's startup state, normal mode.
 * @param mode - Neovim's current mode, as it reports it.
 * @returns true when the mode takes the user's own input source.
 */
export function modeReadsText(mode: string | undefined): boolean {
  if (mode === undefined) return false
  return mode.startsWith('i') || mode.startsWith('R') || mode === 's' || mode === 'S'
}
