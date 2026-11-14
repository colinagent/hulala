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
  type Component,
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
  TuiAltScreen,
} from '@earendil-works/pi-tui'
import { composerBindings } from '../keys.js'
import { imePolicyOf, type ImePolicy } from '../pane/focus.js'
import type { CaretShape } from '../pane/screenSession.js'
import { copyToClipboard, liveClipboardPorts, type CopyProblem } from '../clipboard.js'
import { t } from '../i18n/index.js'
import { StreamTerminal, type TerminalStreams } from '../terminal.js'

/** DECSCUSR code for each caret shape the client hands the terminal. */
const CURSOR_SHAPE_CODES: Record<CaretShape, number> = { block: 2, underline: 4, bar: 6 }

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
  /**
   * Hand the caret to the terminal in this shape.
   *
   * A program column draws no caret of its own: its cell carries pi-tui's
   * cursor marker and the terminal draws the cursor there, in the shape the
   * program asked for (DECSCUSR). Focus decides who owns the caret at all; a
   * surface that declares no shape gets its own fake cursor back.
   * @param shape - the caret shape the column's program asked for.
   */
  setCaretShape(shape: CaretShape): void
  /**
   * Put `title` on the terminal's window title (the tab or window label).
   *
   * Control characters are replaced, so text that came from the Host cannot end
   * the OSC sequence early.
   * @param title - the complete window title.
   */
  setTitle(title: string): void
  /**
   * Show a program's title while its column has the keyboard.
   *
   * `undefined` restores the client's own title (the one {@link setTitle} last
   * set). A column is not allowed to rename the window for good: the title
   * belongs to the Session.
   * @param title - the program's title, or undefined to restore.
   */
  setOverlayTitle(title: string | undefined): void
  /**
   * Give the terminal back. Idempotent; the context also calls it on dispose.
   */
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
   * Move the keyboard and report what the new surface reads keys as.
   *
   * This is the only way focus moves: the input source is a consequence of the
   * surface, and a surface states its own semantics with an `imePolicy` field
   * (`../pane/focus.ts`). A surface that omits the field reads text, so the
   * client leaves the user's source alone until something declares otherwise.
   * @param component - the component taking the keyboard.
   */
  focus(component: Component): void
  /**
   * Report what a component reads keys as when it takes the keyboard outside
   * {@link TuiTerminal.focus}.
   *
   * A pi-tui overlay (an approval, a question, a conflict dialog) is pushed onto
   * the screen's own stack, not moved through focus, so it has to say what it is
   * the same way: once with itself while it is up, and once through
   * {@link TuiTerminal.refreshIme} when it closes.
   * @param component - the surface that just took the keyboard.
   */
  announce(component: Component): void
  /**
   * Re-read the policy of the component that already holds the keyboard.
   *
   * For a surface whose keys change meaning while it stays focused — Neovim in
   * insert mode — which updates its own `imePolicy` field and then asks for the
   * new answer.
   */
  refreshIme(): void
  /**
   * Hear every change of what the focused surface reads keys as.
   *
   * The listener runs only when the policy actually changes, so a window that
   * moves between two command surfaces never reports anything.
   * @param observer - what to call with the new policy.
   */
  observeIme(observer: (policy: ImePolicy) => void): void
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
  /**
   * Copy selected text to the clipboard; tests inject a recorder.
   *
   * Absent, the client writes the clipboard of the machine it can reach (see
   * {@link copySelectedText}).
   */
  readonly copySelection?: (text: string) => Promise<boolean | string>
}

/** The client's own way of putting a selection on the clipboard. */
function copySelectedText(write: (data: string) => void): (text: string) => Promise<boolean | string> {
  const ports = liveClipboardPorts(write)
  return async text => {
    try {
      const result = await copyToClipboard(text, ports)
      return result === 'copied' ? true : copyProblemText(result)
    } catch {
      // The renderer awaits this promise without a guard, so a rejection here
      // would take the whole client down: report it as a plain failure instead.
      return copyProblemText('unsupported')
    }
  }
}

/** The one line a failed copy shows, in the client's language. */
function copyProblemText(problem: CopyProblem): string {
  switch (problem) {
    case 'too-large': return t('clipboard.tooLarge')
    case 'wayland': return t('clipboard.wayland')
    case 'x11': return t('clipboard.x11')
    case 'unsupported': return t('clipboard.unsupported')
  }
}

/** Construct the terminal, install the keybinding table, and own both. */
export function apply(ctx: Context, config: TerminalPluginConfig): void {
  const terminal = new StreamTerminal({ input: config.input, output: config.output } as TerminalStreams)
  // The hardware cursor is the caret a program column shows. A grid cell holds
  // one glyph, so drawing Neovim's insert-mode bar in the grid would have to
  // delete the character under it; the terminal's own cursor composites over the
  // character instead, which is exactly how a bar looks in the terminal Neovim
  // runs in. It only drives the caret while a column holds the keyboard (see
  // `setCaretShape`), so the rest of the client keeps its own fake cursors.
  const screen = new TuiAltScreen(terminal, true, undefined, {
    // Copy-on-select is the alternate screen's own drag selection, and the copy
    // has to land on the clipboard the user pastes from: the terminal's over a
    // remote link, this machine's when the client runs where the user sits.
    copySelection: config.copySelection ?? copySelectedText(data => { terminal.write(data) }),
  })
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
  /** The shape the terminal is currently asked to draw the caret in. */
  let caretShape: CaretShape | undefined
  ctx.effect(() => stop, 'hulala: terminal restore')
  const setPaging = (viewport: boolean): void => {
    viewportPaging = viewport
    applyPaging()
  }
  const setMenuPaging = (menu: boolean): void => {
    menuPaging = menu
    applyPaging()
  }

  // What the surface that holds the keyboard reads the keys as. The client's
  // input source follows this and nothing else (`editor/inputSource.ts`).
  let imePolicy: ImePolicy = 'text'
  const imeObservers: ((policy: ImePolicy) => void)[] = []
  const publish = (next: ImePolicy): void => {
    if (next === imePolicy) return
    imePolicy = next
    for (const observer of imeObservers) observer(next)
  }

  /**
   * Hand the caret to the terminal, in the shape a focused column's program
   * asked for.
   *
   * Neovim sends a bar in insert mode and a block in normal mode, so the caret
   * the terminal draws says which mode the editor is in — the same signal its
   * own window shows — without the client replacing the character with a bar
   * glyph (a grid cell holds one glyph, so that would delete the character).
   * A component that declares no shape keeps its own fake cursor.
   * @param shape - the caret shape, or `undefined` for the terminal's own.
   */
  const setCaretShape = (shape: CaretShape | undefined): void => {
    if (shape === caretShape) return
    caretShape = shape
    screen.setShowHardwareCursor(shape !== undefined)
    // Steady shapes: the shape is the program's signal, and a blink it did not
    // ask for would read as the terminal's.
    terminal.write(shape === undefined ? '\u001b[0 q' : `\u001b[${CURSOR_SHAPE_CODES[shape]} q`)
  }

  /** The shape a surface declares, if it declares one at all. */
  const caretOf = (component: Component | null): CaretShape | undefined =>
    (component as { caretShape?: () => CaretShape } | null)?.caretShape?.()

  const announcePolicy = (component: Component): void => {
    publish(imePolicyOf(component))
  }

  const refreshIme = (): void => {
    // Read the component that actually holds the keyboard rather than the one
    // just asked for: pi-tui may retarget focus around an overlay.
    const component = screen.getFocusedComponent()
    if (component === null) return
    announcePolicy(component)
    // An overlay that closes puts the caret back on the surface under it.
    setCaretShape(caretOf(component))
  }

  const focus = (component: Component): void => {
    screen.setFocus(component)
    refreshIme()
  }

  const observeIme = (observer: (policy: ImePolicy) => void): void => {
    imeObservers.push(observer)
  }

  ctx.provide('hulalaTerminal', {
    terminal,
    screen,
    keybindings,
    stop,
    setPaging,
    setMenuPaging,
    focus,
    announce: announcePolicy,
    refreshIme,
    observeIme,
    setCaretShape,
    setTitle: title => { terminal.setTitle(title) },
    setOverlayTitle: title => { terminal.setOverlayTitle(title) },
  })
}

/** Cordis object-form plugin. */
export const terminalPlugin = { name: 'hulala-terminal', apply }
