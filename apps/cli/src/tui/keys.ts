/**
 * Application-level keybindings and the slash-command completion table.
 *
 * Rendering and input parsing are owned by pi-tui; this module only names the
 * commands the composer completes and the keys the app intercepts globally.
 *
 * The frame has three columns: the session rail on the left, the conversation in
 * the middle, and one sidebar column on the right — the built-in terminal on
 * `Ctrl-T`, Neovim on `Ctrl-F`. The two sidebar columns are mutually exclusive
 * but keep their own processes while the other is shown. Each column key is a
 * visibility toggle: a painted column is closed by its own key wherever the
 * keyboard is, and `Ctrl-F` asks Neovim to leave before closing it, so unwritten
 * buffers are a question rather than a kill. `Ctrl-D` puts the conversation
 * column away or brings it back; it refuses to hide while the rail and the
 * sidebar are both closed, because there would be nothing left on screen.
 * `Ctrl-Q` exits, in the slot pi gives
 * `Ctrl-D`. `Ctrl-G` is the rail's visibility toggle: a shown rail is put away,
 * a hidden one comes back with the keyboard on the list, and it never doubles as
 * a focus cycle. `Ctrl-[` / `Ctrl-]` move focus between the columns; `Ctrl-[` is
 * the same byte as `Esc`, so Neovim keeps it whenever it
 * has something to cancel (see `tui/pane/focus.ts`) and the terminal keeps it
 * while a full-screen program owns the alternate screen. `Ctrl-W` is not
 * intercepted while a column has focus, so Neovim's window prefix works; the
 * column keys do take `<C-t>` and `<C-f>` from Neovim, which is the price of
 * naming the two columns.
 *
 * @module hulala-cli/tui/keys
 */
import { matchesKey, type KeybindingsConfig, type SlashCommand } from '@earendil-works/pi-tui'

/** Slash commands offered by the completion menu (`name` excludes the `/`). */
export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help', description: 'show commands' },
  { name: 'sessions', description: 'list and switch Sessions' },
  { name: 'new', description: 'start a new Session in this directory' },
  { name: 'resume', description: 'pick or open a saved Session', argumentHint: '[id]' },
  { name: 'model', description: 'select the model', argumentHint: '[provider/model]' },
  { name: 'login', description: 'add a provider API key', argumentHint: '[provider]' },
  { name: 'rename', description: 'rename the current Session', argumentHint: '<title>' },
  { name: 'cancel', description: 'cancel the running turn' },
  { name: 'status', description: 'show Session and turn state' },
  { name: 'editor', description: 'open or close the nvim column' },
  { name: 'terminal', description: 'open or close the built-in terminal column' },
  { name: 'reasoning', description: 'cycle reasoning display mode' },
  { name: 'clear', description: 'clear the transcript' },
  { name: 'update', description: 'install the downloaded release and restart' },
  { name: 'quit', description: 'detach (the Host keeps running)' },
]

/** Alt-screen viewport bindings that would otherwise swallow a column's keys. */
export const VIEWPORT_PAGING_KEYS = ['tui.altScreen.pageUp', 'tui.altScreen.pageDown'] as const

/** The hint every list shows for its two movement gestures. */
export const LIST_MOVE_HINT = '↑↓/Ctrl-N/P move'

/**
 * Whether one input event moves a list selection up or down.
 *
 * Every list in the client answers to the arrow keys and to the readline
 * spellings of the same gesture, so `Ctrl-P`/`Ctrl-N` keep working in the
 * completion menu, the model and provider selectors and the question dialog.
 * @param data - one raw input event.
 * @param direction - the movement to test for.
 * @returns true when the event is that movement.
 */
export function listMove(data: string, direction: 'up' | 'down'): boolean {
  if (matchesKey(data, direction)) return true
  return matchesKey(data, direction === 'up' ? 'ctrl+p' : 'ctrl+n')
}

/**
 * Readline arrows for the composer itself.
 *
 * The base editor treats `tui.editor.cursorUp`/`cursorDown` as both cursor
 * movement and prompt history, so binding `Ctrl-P`/`Ctrl-N` to them gives the
 * composer the same two keys without a second navigation path.
 */
const COMPOSER_LIST_KEYS: KeybindingsConfig = {
  'tui.editor.cursorUp': ['up', 'ctrl+p'],
  'tui.editor.cursorDown': ['down', 'ctrl+n'],
}

/**
 * Bind or release the keys that page the transcript.
 *
 * `TuiAltScreen` registers its own input listener when it is constructed, which
 * is before the app's listener and before any component sees the key, and binds
 * `PageUp`/`PageDown` to scrolling the conversation. A column beside the
 * transcript would never receive them. Releasing these two while a column has
 * focus is what lets the terminal page its own history and Neovim page its
 * buffer; the transcript gets the keys back when focus returns to the composer.
 * @param transcriptOwnsPaging - true while the composer has focus.
 * @returns user bindings to install for the running `KeybindingsManager`.
 */
export function viewportPagingBindings(transcriptOwnsPaging: boolean): KeybindingsConfig {
  if (transcriptOwnsPaging) return {}
  return Object.fromEntries(VIEWPORT_PAGING_KEYS.map(id => [id, []]))
}

/**
 * Every user binding the composer needs.
 *
 * Combines the list arrows with the transcript paging decision, because
 * `setUserBindings` replaces the whole map: losing one set while installing the
 * other would either strand `Ctrl-P`/`Ctrl-N` or hand PageUp/PageDown back to
 * the transcript while a column is focused.
 * @param transcriptOwnsPaging - true while the composer has focus.
 * @returns user bindings to install for the running `KeybindingsManager`.
 */
export function composerBindings(transcriptOwnsPaging: boolean): KeybindingsConfig {
  return { ...COMPOSER_LIST_KEYS, ...viewportPagingBindings(transcriptOwnsPaging) }
}
