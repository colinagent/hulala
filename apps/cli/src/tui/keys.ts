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
import { t } from './i18n/index.js'

/**
 * Slash commands offered by the completion menu (`name` excludes the `/`).
 *
 * Built on demand instead of stored in a constant: the descriptions follow the
 * active interface language, and a switch must show up in the next completion
 * menu without a restart.
 */
export function slashCommands(): SlashCommand[] {
  return [
    { name: 'help', description: t('slash.help') },
    { name: 'sessions', description: t('slash.sessions') },
    { name: 'new', description: t('slash.new') },
    { name: 'resume', description: t('slash.resume'), argumentHint: '[id]' },
    { name: 'model', description: t('slash.model'), argumentHint: '[provider/model]' },
    { name: 'thinking', description: t('slash.thinking'), argumentHint: '[level]' },
    { name: 'login', description: t('slash.login'), argumentHint: '[provider]' },
    { name: 'rename', description: t('slash.rename'), argumentHint: '<title>' },
    { name: 'cancel', description: t('slash.cancel') },
    { name: 'status', description: t('slash.status') },
    { name: 'editor', description: t('slash.editor') },
    { name: 'terminal', description: t('slash.terminal') },
    { name: 'reasoning', description: t('slash.reasoning') },
    { name: 'clear', description: t('slash.clear') },
    { name: 'update', description: t('slash.update') },
    { name: 'language', description: t('slash.language'), argumentHint: '[en|zh-CN]' },
    { name: 'quit', description: t('slash.quit') },
  ]
}

/** Alt-screen viewport bindings that would otherwise swallow a column's keys. */
export const VIEWPORT_PAGING_KEYS = ['tui.altScreen.pageUp', 'tui.altScreen.pageDown'] as const

/** The hint every list shows for its two movement gestures. */
export function listMoveHint(): string {
  return t('list.moveHint')
}

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
