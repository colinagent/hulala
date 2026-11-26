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
import { installTerminalGuard } from '../terminal/guard.js'
import {
  createBufferedOutput,
  type BufferedSurface,
  type FrameControl,
  type LostReason,
  type OutputSurface,
} from '../terminal/writer.js'
import { StreamTerminal, type TerminalStreams } from '../terminal.js'

/** DECSCUSR code for each caret shape the client hands the terminal. */
const CURSOR_SHAPE_CODES: Record<CaretShape, number> = { block: 2, underline: 4, bar: 6 }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The terminal device, its screen, and the active keybinding table. */
    hulalaTerminal: TuiTerminal
  }
  interface Events {
    /**
     * A frame was discarded instead of written.
     *
     * The queue is capped so a terminal that is not reading cannot grow the
     * process, a descriptor can refuse a frame, and a frame composed for a grid
     * the window no longer has is refused on purpose. Whichever happened, the
     * renderer's copy of the screen now counts a frame that the terminal never
     * received, so it is thrown away and every row is painted again. Listening
     * is not optional: a frame lost without a repaint leaves those cells wrong
     * until something else forces one.
     */
    'hulala/output-lost'(reason: LostReason): void
    /**
     * The reader activated one link in the conversation.
     *
     * A click on a hyperlink is the client's, not the terminal's: mouse
     * reporting is on, so the terminal never sees the click, and what a link
     * names is not always something this machine can open — a file named in the
     * conversation lives in the Host's filesystem, which may be another machine.
     * Resolving it is a resource question (`data/resource.ts`), not a terminal
     * one, so this carries the raw target and nothing more.
     */
    'hulala/open-resource'(href: string): void
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
   * Put the terminal back synchronously: alternate screen, mouse modes, paste
   * mode, cursor.
   *
   * The same sequences `stop()` writes, on the file descriptor, so a crash or a
   * signal can run it. A terminal left in mouse mode is unusable after the client
   * is gone — the shell receives the reports and echoes them as text.
   */
  restoreTerminal(): void
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
   * Apply the focus a modal stood in the way of, now that it is gone.
   *
   * {@link TuiTerminal.focus} holds its request while a dialog is up instead of
   * moving the keyboard off it. Whoever closes a dialog calls this once, after
   * the overlay is hidden and before {@link TuiTerminal.refreshIme}.
   */
  releaseHeldFocus(): void
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
  /** Append one diagnostic line; only set while `HULALA_DEBUG_CLIENT` is. */
  readonly debug?: (message: string) => void
  /**
   * How long a lone escape waits for the rest of its sequence.
   *
   * The terminal's `ttimeoutlen`. Tests shorten it so they need not wait a tenth
   * of a second for every Escape.
   */
  readonly escapeTimeoutMs?: number
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

/** One console argument as one line of text; never throws on a circular value. */
function consoleText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Keep library logging off the frame.
 *
 * The transport's libraries log to the console — `[connection] connection lost,
 * retry #447` is one of them — and stderr is the very terminal the alternate
 * screen is painting. One stray line lands in the middle of the transcript and
 * stays there until the next full repaint, which is a window that looks broken
 * for reasons that have nothing to do with it.
 *
 * While this plugin owns the screen, console output goes to the debug log
 * instead. The real methods come back the moment the terminal is given back, so
 * a message printed after the window is gone — the client's own error path, a
 * successor's output — still reaches the user.
 * @param debug - diagnostic sink; absent means the lines are dropped.
 * @returns the restore function.
 */
function captureConsole(debug: ((message: string) => void) | undefined): () => void {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
  const original = methods.map(method => console[method])
  for (const method of methods) {
    console[method] = (...args: unknown[]): void => {
      debug?.(`console.${method} ${args.map(consoleText).join(' ')}`)
    }
  }
  return () => {
    for (const [index, method] of methods.entries()) {
      console[method] = original[index] as typeof console[typeof method]
    }
  }
}

/** Construct the terminal, install the keybinding table, and own both. */
/**
 * Paint through a queue when the surface is a real terminal.
 *
 * A tty write is synchronous, so a terminal that stopped draining its pty blocks
 * the event loop — and a blocked loop stops reading stdin, which is how the pty
 * ends up dropping the middle of a mouse report. The queue moves that wait to a
 * thread-pool write; an injected stream (a test, a pipe) never blocks that way
 * and is painted directly.
 * @param output - the surface the window would paint.
 * @param onLost - what to call for a frame the queue discarded.
 * @param debug - diagnostic sink; a frame that carried bare control bytes names
 *   its row here, which is what separates "the model composed a bad row" from
 *   "a frame never arrived".
 * @returns the surface to paint through.
 */
function paintSurface(
  output: TerminalPluginConfig['output'],
  onLost: (reason: LostReason) => void,
  debug?: (message: string) => void,
): (TerminalStreams['output'] & { dispose?: () => void }) & { stats?: BufferedSurface['stats'] } {
  const fd = (output as { fd?: number }).fd
  if (output.isTTY !== true || typeof fd !== 'number') return output as TerminalStreams['output']
  return createBufferedOutput(output as unknown as OutputSurface & { fd: number }, {
    onLost,
    ...(debug === undefined ? {} : {
      onControl: (controls: readonly FrameControl[]): void => {
        const found = controls
          .map(entry => `row=${String(entry.row)} 0x${entry.code.toString(16).padStart(2, '0')}=${String(entry.count)}`)
          .join(' ')
        debug(`frame control ${found}`)
      },
    }),
  })
}

export function apply(ctx: Context, config: TerminalPluginConfig): void {
  /** The queue, once it exists: the loss report reads its counters. */
  let surface: { stats?: BufferedSurface['stats'] } | undefined
  const output = paintSurface(config.output, reason => {
    // The counters are what turns the log line into a diagnosis: a frame that was
    // composed and never committed is the queue's doing, and one that was
    // committed but is on screen wrong is the terminal's.
    const stats = surface?.stats?.()
    config.debug?.(`frame lost ${reason}${stats === undefined
      ? ''
      : ` composed=${String(stats.composed)} committed=${String(stats.committed)} lost=${JSON.stringify(stats.lost)}`}`)
    ctx.emit('hulala/output-lost', reason)
  }, config.debug)
  surface = output
  const terminal = new StreamTerminal(
    { input: config.input, output } as TerminalStreams,
    {
      ...(config.debug === undefined ? {} : { trace: config.debug }),
      ...(config.escapeTimeoutMs === undefined ? {} : { escapeTimeoutMs: config.escapeTimeoutMs }),
    },
  )
  // A closed window ends its stdin. Nothing on screen can be shown any more, so
  // the client leaves instead of holding a Host connection and a forward open for
  // as long as the machine is up — a stale client is a client with an older build.
  terminal.onHangup(() => { ctx.emit('hulala/hangup') })
  // The terminal is ours from here: every way out has to give it back, including
  // the ways that skip the client's own shutdown.
  const restoreTerminal = installTerminalGuard(() => { terminal.flushSync() })
  // Nothing else may write to the device while this plugin paints it. The guard
  // is installed first so a crash still restores the screen, and the console is
  // captured second so its lines cannot land on the frame in between.
  const restoreConsole = captureConsole(config.debug)
  ctx.effect(() => restoreConsole, 'hulala: console capture')
  // The queue dies with the plugin: after the terminal is given back nothing may
  // still be writing a frame to it.
  ctx.effect(() => () => { output.dispose?.() }, 'hulala: output queue')
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
    // A press and release on the same cell is a click on the link under it, and
    // pi-tui hands over the target the frame was drawn with. Without this the
    // click falls into the selection machinery and a rendered link is decoration.
    openUrl: href => { ctx.emit('hulala/open-resource', href) },
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
  /**
   * The shape the terminal is currently asked to draw the caret in.
   *
   * `null` until the first request: the renderer is constructed with the
   * hardware cursor on, so the first "no column owns the caret" must switch it
   * off instead of being skipped as a no-op. Otherwise the composer's fake block
   * is dropped and the terminal's own cursor sits there — blinking, in whatever
   * shape and blink setting the user gave their terminal.
   */
  let caretShape: CaretShape | undefined | null = null
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

  /**
   * The focus a dialog stood in the way of.
   *
   * A panel may re-assert itself while an overlay is up — the rail losing its
   * columns to a narrower window is the case that bit. Moving the keyboard then
   * is worse than losing the request: pi-tui records the dialog's focus restore
   * as blocked by the new component, and every later `y`/`f`/`n` is typed into
   * the composer while the dialog still fills the screen. The keyboard stays
   * with the overlay; the last request is kept and applied when it closes.
   */
  let heldFocus: Component | undefined

  const focus = (component: Component): void => {
    // An overlay takes the keyboard through `showOverlay`, never through here,
    // so a visible one means the caller is asking for the screen behind it.
    if (screen.hasOverlay()) {
      heldFocus = component
      return
    }
    screen.setFocus(component)
    refreshIme()
  }

  const releaseHeldFocus = (): void => {
    if (heldFocus === undefined || screen.hasOverlay()) return
    const component = heldFocus
    heldFocus = undefined
    screen.setFocus(component)
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
    releaseHeldFocus,
    observeIme,
    setCaretShape,
    setTitle: (title: string) => { terminal.setTitle(title) },
    restoreTerminal,
    setOverlayTitle: (title: string | undefined) => { terminal.setOverlayTitle(title) },
  })
}

/** Cordis object-form plugin. */
export const terminalPlugin = { name: 'hulala-terminal', apply }
