/**
 * The terminal half of the client: the bytes on stdin/stdout, the alternate
 * screen, and the keybinding table pi-tui reads globally.
 *
 * This is the only plugin that touches the terminal device. Everything above it
 * — layout, seats, overlays, the composer — asks it for dimensions and a repaint
 * and never writes escape sequences itself, which is what keeps "who owns the
 * screen" answerable (see the decision in
 * `2026-11-02-tui-pi-tui.md`: exactly one owner).
 *
 * Disposal is the plugin's, not the caller's: `ctx.effect` restores the screen
 * and drops the keybinding table, so a window that closes for any reason gives
 * the terminal back. `stop()` stays exported because `/update` hands the terminal
 * to the new client *before* the context is torn down, and that ordering is the
 * caller's to decide.
 *
 * @module hulala-cli/tui/plugins/terminal
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
  TuiAltScreen,
} from '@earendil-works/pi-tui'
import { composerBindings } from '../keys.js'
import { StreamTerminal, type TerminalStreams } from '../terminal.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The terminal device, its screen, and the active keybinding table. */
    hulalaTerminal: TuiTerminal
  }
}

/** What a plugin above the terminal needs from it. */
export interface TuiTerminal {
  readonly terminal: StreamTerminal
  readonly screen: TuiAltScreen
  readonly keybindings: KeybindingsManager
  /** Give the terminal back. Idempotent; the context also calls it on dispose. */
  stop(): void
  /**
   * Decide whether the transcript or the focused column owns `PageUp`/`PageDown`.
   *
   * The alt-screen viewport claims those keys before any component sees them, so
   * while the keyboard is in a column they must not scroll the conversation.
   * @param viewport - true when the transcript should own the paging keys.
   */
  setPaging(viewport: boolean): void
  /**
   * Decide whether the open completion menu owns `PageUp`/`PageDown`.
   *
   * The menu pages its own five-row window, so the viewport must not take the
   * keys first. It is tracked apart from {@link TuiTerminal.setPaging} on
   * purpose: a menu that closes while a column still has the keyboard must not
   * hand the keys back to the transcript.
   * @param menu - true while the completion menu is on screen.
   */
  setMenuPaging(menu: boolean): void
}

/** Streams and the composer's initial key mode. */
export interface TerminalPluginConfig {
  readonly input: NodeJS.ReadableStream & { isTTY?: boolean }
  readonly output: NodeJS.WritableStream & { isTTY?: boolean }
  /** Whether the composer starts in viewport paging mode. */
  readonly composerPaging: boolean
}

/** Construct the terminal, install the keybinding table, and own both. */
export function apply(ctx: Context, config: TerminalPluginConfig): void {
  const terminal = new StreamTerminal({ input: config.input, output: config.output } as TerminalStreams)
  const screen = new TuiAltScreen(terminal)
  // One manager instance, mutated later: `TuiAltScreen` resolves its viewport
  // keys through the globally installed manager on every keystroke.
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS)
  setKeybindings(keybindings)
  // Two independent owners of the paging keys: the transcript (or not, while a
  // column has the keyboard) and the completion menu, which pages its own
  // window while it is up. One boolean each, resolved into the one user-binding
  // table pi-tui replaces wholesale.
  let viewportPaging = config.composerPaging
  let menuPaging = false
  const applyPaging = (): void => {
    keybindings.setUserBindings(composerBindings(viewportPaging && !menuPaging))
  }
  // Install the composer's readline arrows before the first paint, not only
  // after the first focus change.
  applyPaging()

  const stop = (): void => {
    // pi-tui guards `stopped`, so the explicit stop in `shutdown()` and this
    // one cannot fight each other.
    screen.stop()
  }
  ctx.effect(() => stop, 'hulala: terminal restore')
  const setPaging = (viewport: boolean): void => {
    viewportPaging = viewport
    applyPaging()
  }
  const setMenuPaging = (menu: boolean): void => {
    menuPaging = menu
    applyPaging()
  }

  ctx.provide('hulalaTerminal', { terminal, screen, keybindings, stop, setPaging, setMenuPaging })
}

/** Cordis object-form plugin. */
export const terminalPlugin = { name: 'hulala-terminal', apply }
