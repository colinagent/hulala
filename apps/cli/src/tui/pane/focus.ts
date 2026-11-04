/**
 * Who owns `Ctrl-[` while the editor column has focus.
 *
 * The sidebar holds one program only — Neovim — and `Ctrl-[` is the same byte as
 * `Esc`, so it cannot simply be taken away from it: that key is the only way out
 * of insert, visual, command-line and operator-pending mode. In normal mode it
 * has nothing to cancel (and our config maps `<esc>` to clearing the search
 * highlight), so there it means "back to the composer" instead.
 *
 * @module hulala-cli/tui/pane/focus
 */

/**
 * Whether Neovim keeps `Ctrl-[` instead of it moving focus to the composer.
 * @param editorMode - the mode reported through `ModeChanged`, if any.
 * @returns true when the key belongs to Neovim.
 */
export function editorOwnsEscape(editorMode: string | undefined): boolean {
  // A missing mode is Neovim's startup state, which is normal mode.
  return editorMode !== undefined && editorMode !== 'n'
}
