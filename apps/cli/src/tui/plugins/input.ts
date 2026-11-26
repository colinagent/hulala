/**
 * The one input pipeline.
 *
 * Every byte the terminal produces passes here once, and the order below is the
 * whole design: a modal owns the keyboard, then the four panel keys, then the
 * rail, then a focused column, then the composer, then the client's own keys.
 * Keyboard precedence cannot be decided by whichever plugin registered last — a
 * plugin that ate `Ctrl-C` would make the client impossible to interrupt, and a
 * column that ate a panel key would strand the keyboard inside a program.
 *
 * No chord is spelled here. Every check is `matchesAction(id, data)`, so the keys
 * this pipeline answers to are the ones in `config/keybindings.json`, and the
 * startup hints and `/help` print those same bindings.
 *
 * The four panel keys — `Ctrl-D` (Session rail), `Ctrl-F` (conversation),
 * `Ctrl-T` (terminal column) and `Ctrl-G` (Neovim column) — answer from wherever
 * the keyboard is, a focused column included. Each one is a cycle owned by the
 * command surface (`commands.focusPanel`): a panel without the keyboard takes
 * it, a panel with it is put away, and a panel that is away comes back with the
 * keyboard on it. Because they are single control letters, no Command chord and
 * no Kitty report is needed to move between panels; `Ctrl-H` stays a text
 * surface's backspace (the listener projects both of its encodings onto the
 * Backspace byte) and `Ctrl-L` stays Neovim's redraw.
 *
 * `Ctrl-Shift-G` is not a panel key: it is "just the editor". The mode itself
 * lives in the command surface (`commands.toggleEditorOnly`), because the key and
 * `/nvim` are one action and must share one layout snapshot; this module only
 * routes the chord to it. The `G` is the editor's panel key with Shift held, and
 * the chord needs the Kitty report; `/nvim` is the equal that needs none. Not
 * `Ctrl-I`: that is the `Tab` byte, so a legacy terminal would deliver completion
 * instead of the mode.
 *
 * `Ctrl-Q` exits, in the slot pi gives `Ctrl-D`. `Esc` is the one key that
 * belongs to a column's program whenever the program has something to cancel,
 * which the editor reports through its mode file and the terminal through the
 * alternate screen.
 *
 * `Ctrl-,` / `Ctrl-.` walk the Sessions from wherever the keyboard is, with
 * `Ctrl-↑`/`Ctrl-↓` behind them for a terminal that reports no Kitty sequence for
 * the comma and the period — the walk is the rail's own order, so a hidden or
 * folded rail changes nothing. Inside the rail `Ctrl-N`/`Ctrl-P` still move the
 * cursor: one pair moves Sessions, the other moves a highlight.
 *
 * @module hulala-cli/tui/plugins/input
 */
import type { Context } from '@deepseek-ai/cordis'
import { isKeyRelease, matchesKey, type TuiInputListenerResult } from '@earendil-works/pi-tui'
import { matchesAction, KEY_ACTIONS } from '../../keymap.js'
import { isMouseReport } from '../input/mouse.js'
import { isStrayTerminalReport } from '../input/reports.js'
import { t } from '../i18n/index.js'
import type { FramePanel } from './commands.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The raw terminal input pipeline. */
    hulalaInput: TuiInput
  }
}

/** Nothing outside needs to call into the pipeline; it is published for tests. */
export interface TuiInput {
  /** Stop listening. The context also does this on dispose. */
  dispose(): void
}

/** How long a second `Esc` counts as the same gesture, as in pi. */
const DOUBLE_ESCAPE_MS = 500

/** Every action id, so one `Ctrl-H` press can be checked against the whole keymap. */
const ACTION_IDS: readonly string[] = KEY_ACTIONS.map(action => action.id)

/**
 * The four panel keys, in the order they are checked.
 *
 * One row per panel, because the keys mean the same thing everywhere: take the
 * keyboard to that panel, or put the panel away. The cycle itself is the command
 * surface's (`commands.focusPanel`), which knows how many panels are drawn.
 */
const PANEL_ACTIONS: ReadonlyArray<readonly [action: string, panel: FramePanel]> = [
  ['panel.rail', 'rail'],
  ['panel.chat', 'chat'],
  ['panel.terminal', 'terminal'],
  ['panel.editor', 'editor'],
]

/**
 * The byte a legacy terminal and a Kitty report agree on for Backspace.
 *
 * `0x7f` is what the Backspace key itself sends, and what every component in
 * pi-tui and this client tests for (`matchesKey(data, 'backspace')`), so it is the
 * form `Ctrl-H` is projected onto below.
 */
const BACKSPACE_BYTE = '\u007f'

/**
 * Whether one event is `Ctrl-H`, the alternate backspace.
 *
 * Both encodings count: the legacy `0x08` byte, and the `CSI 104;5u` report a
 * Kitty-protocol terminal sends once the client has asked for the disambiguation
 * report. `matchesKey` answers for both.
 * @param data - one raw input event.
 * @returns true when the event is the `Ctrl-H` chord.
 */
function isCtrlH(data: string): boolean {
  return matchesKey(data, 'ctrl+h')
}

/** Debug sink for one event. */
export interface InputPluginConfig {
  readonly debug: (message: string) => void
}

/** Install the pipeline. */
export function apply(ctx: Context, config: InputPluginConfig): void {
  const { screen, focus: focusOn } = ctx.hulalaTerminal
  const render = ctx.hulalaRender
  const overlays = ctx.hulalaOverlays
  const rails = ctx.hulalaRail
  const panes = ctx.hulalaPanes
  const session = ctx.hulalaSession
  const layout = ctx.hulalaLayout
  const commands = ctx.hulalaCommands
  const view = ctx.hulalaView
  const lifecycle = ctx.hulalaLifecycle
  const { reducer } = ctx.hulalaViewModel
  const { editor } = ctx.hulalaComposer

  let lastSigint = 0
  let lastEscape = 0

  const quit = (): void => { ctx.emit('hulala/quit') }

  /**
   * The panel one chord names, or undefined when the chord is not a panel key.
   *
   * Read from the active keymap on every event, so a rebound panel key answers
   * at once (`/keys` reloads the file) and the four keys never fall out of step
   * with `/help`.
   * @param data - one raw input event.
   * @returns the panel, named the way `commands.focusPanel` expects it.
   */
  const panelOf = (data: string): FramePanel | undefined =>
    PANEL_ACTIONS.find(([action]) => matchesAction(action, data))?.[1]

  const interrupt = async (): Promise<void> => {
    if (reducer.busy && session.id !== undefined) {
      await commands.cancel()
      return
    }
    const now = Date.now()
    if (now - lastSigint < 2_000) {
      quit()
      return
    }
    lastSigint = now
    reducer.addNotice(t('input.pressAgain'))
    render.repaint()
  }

  /**
   * Which divider a keyboard resize moves.
   *
   * A column's rule belongs to its left edge, so the focused pane moves its own
   * rule and the focused conversation moves the rail's rule beside it. With the
   * conversation put away only the rail's rule is drawn, and the frame turns that
   * column into the pane's width. Steps the pointer could also take: the boundary
   * follows the key, which widens the column on its right and narrows the one on
   * its left.
   *
   * With both side columns away (the editor alone, as `Ctrl-Shift-G` leaves it) the
   * frame has no boundary at all, so the key goes to the editor's own: Neovim's file
   * tree draws the one rule still on screen, and it moves on this same key. There
   * is nothing to trade it against, which is why the hand-off is safe here and not
   * in the layouts that do have a boundary.
   * @param direction - `-1` moves the boundary left, `1` moves it right.
   */
  const moveDivider = (direction: -1 | 1): void => {
    const railShown = layout.railShown
    const paneShown = layout.paneId !== undefined
    if (!layout.conversationShown) {
      if (railShown) rails.moveDivider(direction)
      else if (paneShown && !panes.handOffDivider(direction)) panes.moveDivider(direction)
      return
    }
    if (panes.focused && paneShown) {
      panes.moveDivider(direction)
      return
    }
    if (railShown) rails.moveDivider(direction)
    else if (paneShown) panes.moveDivider(direction)
  }

  // A rewrite (`{ data }`) continues down the pipeline with new bytes: the one
  // use is `Ctrl-H`'s projection onto Backspace, above the dispatch below.
  const listener = (data: string): TuiInputListenerResult => {
    config.debug(`input ${JSON.stringify(data)} active=${String(panes.focused)} overlays=${overlays.open}`)
    // A terminal's own replies (palette answers, DA1, window and cursor
    // reports) are not keys. pi-tui consumes the palette answers while its one
    // startup query is pending; a reply held in the tty's canonical buffer is
    // released at the next raw-mode switch, long afterwards, unclaimed. Without
    // this gate it is typed into the composer — `62`, `22t`, `52c` — and into
    // the shell once the client has stopped reading. It must be swallowed here,
    // before the modal check, or a picker with the keyboard gets it instead.
    if (isStrayTerminalReport(data)) {
      config.debug(`report ${JSON.stringify(data)}`)
      return { consume: true }
    }
    // `Ctrl-H` deletes the character before the caret wherever text is typed, as
    // it does in every Linux tool: in a legacy encoding `<C-h>` and Backspace are
    // one control byte. A Kitty-protocol terminal turns the same key into
    // `CSI 104;5u` instead, which a surface that tests for the Backspace byte
    // would not recognise; the projection below writes both encodings as that
    // byte, so the composer, the rail's filter and a picker's search box delete
    // the same way.
    //
    // Three events are not projected. A key release would become a second press
    // and delete twice. A column's program keeps its own `<C-h>` while it is the
    // surface reading the keyboard: the pty projection already hands it the
    // legacy byte, and Neovim reads both as backspace. A dialog pushed over that
    // column is not the program, though — it owns the keyboard and its search box
    // deletes like every other — so the check is the pair. And a user who bound
    // `Ctrl-H` to an action keeps that action: the frame no longer binds the chord
    // itself (the panels are `Ctrl-D`, `Ctrl-F`, `Ctrl-T` and `Ctrl-G`), but the
    // file is still the user's to change.
    const columnReadsTheKey = panes.focused && overlays.open === 0
    if (!columnReadsTheKey && !isKeyRelease(data) && isCtrlH(data)
      && !ACTION_IDS.some(id => matchesAction(id, data))) {
      return { data: BACKSPACE_BYTE }
    }
    // A modal owns the keyboard and the pointer: its own keys (the Session
    // picker's search, an approval's y/n) must not also drive the columns behind
    // it, and a click or a wheel must not scroll, fold or re-focus one while the
    // dialog is the only surface the user can act on. The dialogs read no pointer
    // input of their own, so there is nothing to forward. Every dialog the client
    // shows goes through `hulalaOverlays.modal()`, which is the count `open`
    // keeps; nothing else pushes a pi-tui overlay.
    if (overlays.open > 0) return isMouseReport(data) ? { consume: true } : undefined

    // The exit key, in the slot pi gives `Ctrl-D`. It always answers, and the
    // shutdown asks a dirty editor before leaving.
    if (matchesAction('app.quit', data)) {
      quit()
      return { consume: true }
    }

    // The command palette answers first among the client's own keys: it is the
    // way out of a forgotten shortcut, and it must open from the rail and from a
    // focused column as well as from the composer.
    if (matchesAction('panel.commands', data)) {
      void commands.openPalette()
      return { consume: true }
    }

    // Neovim-only mode, before the column keys: it is a layout, not a toggle of
    // one column, and it has to work while Neovim itself owns the keyboard.
    if (matchesAction('panel.editorOnly', data)) {
      commands.toggleEditorOnly()
      return { consume: true }
    }

    // The four panel keys, from wherever the keyboard is — the rail, a focused
    // column, the composer, a dialog that is not up. Each is a cycle with one
    // owner (`commands.focusPanel`), so no branch below has to know which panel
    // is painted or which one the key should take the keyboard from.
    const panel = panelOf(data)
    if (panel !== undefined) {
      // A terminal that reports event types sends the release too: the press
      // already moved the keyboard, so the release is only swallowed.
      if (!isKeyRelease(data)) commands.focusPanel(panel)
      return { consume: true }
    }

    // The dividers from the keyboard. The key names the divider's direction, and
    // the divider that answers is the one on the focused column's left: a focused
    // pane moves its own rule, the conversation moves the rail's rule beside it,
    // and the rail - which has no column to its left - moves its own. A candidate
    // that is not painted falls back to the other.
    //
    // `panel.dividerLeft` and `panel.dividerRight` default to several spellings
    // because a terminal can only report what its encoding allows:
    // `Ctrl-Shift-←/→` are plain CSI sequences and every terminal reports them,
    // while `Ctrl-Shift-[ / ]` and `Cmd-Ctrl-[ / ]` need the extended keyboard
    // report the client asks for on start. Arrow chords stay out of the Command
    // family on purpose: macOS claims `Cmd-Ctrl-←/→` for spaces, so that pair can
    // never be ours.
    if (matchesAction('panel.dividerLeft', data)) {
      // A release is swallowed with its press: a terminal that reports event
      // types must not resize twice for one keystroke.
      if (!isKeyRelease(data)) moveDivider(-1)
      return { consume: true }
    }
    if (matchesAction('panel.dividerRight', data)) {
      if (!isKeyRelease(data)) moveDivider(1)
      return { consume: true }
    }

    // Reopen (or put away) the question this Session is waiting on. It answers
    // from the composer and the rail, but not from a focused column: the key is
    // the program's there, and a card is not worth stealing it.
    if (matchesAction('app.interactions', data)) {
      if (ctx.get('hulalaInteractions')?.toggle() === true) return { consume: true }
      return undefined
    }

    // Switching Sessions, from wherever the keyboard is. The walk is the rail's
    // order (`railStepTarget`), so the gesture is the same while the rail is
    // hidden, folded, or holding the keyboard — where `Ctrl-N`/`Ctrl-P` keep
    // moving the cursor instead.
    if (matchesAction('session.previous', data)) {
      rails.step(-1)
      return { consume: true }
    }
    if (matchesAction('session.next', data)) {
      rails.step(1)
      return { consume: true }
    }

    // The rail owns the keyboard while it has focus. Only keys belonging to the
    // whole client are taken here; everything else falls through to
    // `SessionRail.handleInput` (filter typing, `n`, `r`, arrows). The panel keys
    // were already taken above.
    if (rails.focused) {
      if (matchesAction('app.interrupt', data)) {
        if (isKeyRelease(data)) return { consume: true }
        // The filter box is nested inside the rail: its Esc clears the query
        // first, and only the next one leaves the rail.
        if (rails.filterFocused) {
          rails.handleInput(data)
          // Consuming input skips pi-tui's own "dispatch + repaint" step, so the
          // frame has to be requested here or the change waits for the rail tick.
          render.request()
          return { consume: true }
        }
        rails.blur()
        return { consume: true }
      }
      if (matchesAction('app.cancel', data)) {
        void interrupt()
        return { consume: true }
      }
      // Dispatch here instead of relying on pi-tui's focus routing: the rail
      // answers arrows, j/k, Ctrl-N/Ctrl-P, Enter, `n`, `/`, `r` even when the
      // renderer's focus bookkeeping and the client's own flag disagree.
      rails.handleInput(data)
      // A consumed key never reaches the renderer's own repaint path, so the
      // cursor move has to schedule the frame or it waits for the rail tick.
      render.request()
      return { consume: true }
    }

    // While a column has focus every key belongs to its program except the panel
    // keys (already taken) and `Esc`; anything else consumed here would be
    // stolen from the program.
    if (panes.focused) {
      // `Esc` leaves only while the program has nothing to cancel: Neovim in
      // insert mode and a full-screen program keep the key (`ownsEscape`).
      const escapeKey = matchesKey(data, 'escape')
      if (escapeKey) {
        // A release is swallowed with its press, so a terminal that reports event
        // types cannot hand the program a second Esc for one keystroke.
        if (isKeyRelease(data)) return { consume: true }
        if (panes.ownsEscape()) return undefined
        // Neovim still gets the key so its normal-mode `<esc>` mapping (clear the
        // search highlight) runs. The shell does not: readline would keep the key
        // pending as a meta prefix for whatever is typed next.
        if (panes.visible === 'editor') panes.input('\u001b')
        panes.blur()
        return { consume: true }
      }
      return undefined
    }

    // Shift-Tab cycles the thinking level, pi's `app.thinking.cycle`. The
    // completion menu owns the keyboard while it is up, so the chord is left
    // alone there instead of raising a level behind the picker.
    if (matchesAction('app.thinking', data) && !editor.completionMenuOpen) {
      void session.cycleThinking()
      return { consume: true }
    }
    // Esc is the interrupt key, as in pi's `app.interrupt`: it aborts the running
    // turn, and on an idle composer it moves the keyboard into the rail. The
    // completion menu keeps the first press for closing itself, and a focused
    // column keeps the byte while it has something to cancel (above).
    if (matchesAction('app.interrupt', data)) {
      // Kitty-protocol key releases repeat the code without a new press.
      if (isKeyRelease(data)) return { consume: true }
      if (editor.completionMenuOpen) return undefined
      if (reducer.busy) {
        void commands.cancel()
        return { consume: true }
      }
      // Esc is the leftward way out while the rail is on screen, draft or not:
      // the draft survives (blurring does not clear the composer). It also works
      // before the first Session has opened — the list is already painted, and
      // Enter on a row opens one. With the rail put away, the old double-Esc
      // picker stays available on an empty composer.
      if (layout.railWanted) {
        rails.focus()
        return { consume: true }
      }
      if (editor.getText().trim() !== '') return { consume: true }
      if (session.id === undefined) return { consume: true }
      const now = Date.now()
      if (now - lastEscape < DOUBLE_ESCAPE_MS && lastEscape !== 0) {
        lastEscape = 0
        void session.browse()
      } else {
        lastEscape = now
      }
      return { consume: true }
    }
    // pi's `app.message.dequeue`: pull everything the running turn has not
    // claimed back into the composer. Like pi it always answers, so an empty
    // queue says so instead of swallowing the key.
    if (matchesAction('app.dequeue', data)) {
      void commands.dequeue()
      return { consume: true }
    }
    if (matchesAction('app.redraw', data)) {
      render.reconcile('manual')
      return { consume: true }
    }
    // The clipboard is reachable only from this process: read it here and paste
    // a path the Host can open (a screenshot included).
    if (matchesAction('app.pasteImage', data)) {
      void commands.paste()
      return { consume: true }
    }
    if (matchesAction('app.expand', data)) {
      view.toggleExpandAll()
      render.repaint()
      return { consume: true }
    }
    if (matchesAction('app.cancel', data)) {
      if (editor.getText() !== '') {
        editor.setText('')
        return { consume: true }
      }
      void interrupt()
      return { consume: true }
    }
    return undefined
  }

  const remove = screen.addInputListener(listener)
  ctx.effect(() => remove, 'hulala: input pipeline')
  ctx.provide('hulalaInput', { dispose: remove })
}

/** Cordis object-form plugin. */
export const inputPlugin = {
  name: 'hulala-input',
  inject: [
    'hulalaTerminal',
    'hulalaRender',
    'hulalaOverlays',
    'hulalaRail',
    'hulalaPanes',
    'hulalaSession',
    'hulalaLayout',
    'hulalaCommands',
    'hulalaView',
    'hulalaLifecycle',
    'hulalaViewModel',
    'hulalaComposer',
    'hulalaKeymap',
  ],
  apply,
}
