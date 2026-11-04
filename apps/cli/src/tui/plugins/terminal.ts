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
  // Install the composer's readline arrows before the first paint, not only
  // after the first focus change.
  keybindings.setUserBindings(composerBindings(config.composerPaging))

  const stop = (): void => {
    // pi-tui guards `stopped`, so the explicit stop in `shutdown()` and this
    // one cannot fight each other.
    screen.stop()
  }
  ctx.effect(() => stop, 'hulala: terminal restore')
  const setPaging = (viewport: boolean): void => {
    keybindings.setUserBindings(composerBindings(viewport))
  }

  ctx.provide('hulalaTerminal', { terminal, screen, keybindings, stop, setPaging })
}

/** Cordis object-form plugin. */
export const terminalPlugin = { name: 'hulala-terminal', apply }
