/**
 * The one input pipeline.
 *
 * Every byte the terminal produces passes here once, and the order below is the
 * whole design: a modal owns the keyboard, then the rail, then a focused column,
 * then the composer, then the client's own keys. Keyboard precedence cannot be
 * decided by whichever plugin registered last — a plugin that ate `Ctrl-C` would
 * make the client impossible to interrupt, and a column that ate `Ctrl-[` would
 * strand the keyboard inside a program.
 *
 * `Ctrl-[` is the hard case, and the reason this is not just a key table: it is
 * the same byte as `Esc`, so it cannot simply be taken. It moves focus only when
 * the focused program has nothing to cancel, which the editor reports through its
 * mode file and the terminal through the alternate screen.
 *
 * `Ctrl-T` and `Ctrl-F` name the two sidebar columns: the built-in terminal and
 * Neovim. Each is a visibility toggle for its own column: pressing the key while
 * that column is painted closes the sidebar (the terminal hides and keeps its
 * jobs, Neovim is asked to leave) wherever the keyboard is, and pressing the
 * other column's key swaps which one is painted, keeping both processes alive.
 * `Ctrl-G` works the same way for the rail — a shown rail is put away, a hidden
 * one comes back with the keyboard on it — and never a focus cycle: moving
 * between the rail, the conversation and the sidebar is `Ctrl-[`/`Ctrl-]` only.
 *
 * `Ctrl-D` puts the conversation column away or brings it back, and `Ctrl-Q` is
 * the exit key (the slot pi gives `Ctrl-D`). Both are taken before any column
 * sees the key, because a column may be the only thing left on screen when the
 * conversation is hidden.
 *
 * @module hulala-cli/tui/plugins/input
 */
import type { Context } from '@deepseek-ai/cordis'
import { isKeyRelease, matchesKey } from '@earendil-works/pi-tui'
import { t } from '../i18n/index.js'

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

/** Debug sink for one event. */
export interface InputPluginConfig {
  readonly debug: (message: string) => void
}

/**
 * Whether one event is the layout's leftward key.
 *
 * `Ctrl-[` and `Esc` are the same byte (`0x1b`) on every terminal that does not
 * negotiate the Kitty keyboard protocol — which `StreamTerminal` deliberately
 * does not. A terminal configured to report modifiers instead sends `Ctrl-[` as
 * its own sequence (`CSI 27;5;91~`, `CSI 91;5u`), so both spellings count.
 */
function isEscapeInput(data: string): boolean {
  return matchesKey(data, 'escape') || matchesKey(data, 'ctrl+[')
}

/** Install the pipeline. */
export function apply(ctx: Context, config: InputPluginConfig): void {
  const { screen } = ctx.hulalaTerminal
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
   * `Ctrl-D`: put the conversation column away, or bring it back.
   *
   * Hiding is only allowed while a side column remains. The rail and the
   * sidebar are what the user hides the conversation *for*, so one of them has
   * to be on screen; otherwise the frame would lose the transcript, the composer
   * and the keyboard's home at once. The seat registrations stay in place, so the
   * draft and the scroll position survive the round trip.
   */
  const toggleConversation = (): void => {
    if (layout.conversationShown) {
      if (!layout.railShown && layout.paneId === undefined) {
        reducer.addNotice(t('input.keepColumn'))
        render.repaint()
        return
      }
      layout.setConversationVisible(false)
      // The composer left the frame with the conversation. A column that already
      // owns the keyboard keeps it, so hiding from the rail or the sidebar does
      // not move focus; the composer's keyboard goes to a column still painted.
      if (panes.focused || rails.focused) return
      if (panes.visible !== undefined) panes.focus(panes.visible, session.cwd)
      else rails.focus()
      return
    }
    layout.setConversationVisible(true)
    // Coming back lands in the composer, without closing the side column that
    // held the keyboard.
    if (panes.focused) panes.blur()
    else if (rails.focused) rails.blur()
    else screen.setFocus(editor)
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
   * @param direction - `-1` moves the boundary left, `1` moves it right.
   */
  const moveDivider = (direction: -1 | 1): void => {
    const railShown = layout.railShown
    const paneShown = layout.paneId !== undefined
    if (!layout.conversationShown) {
      if (railShown) rails.moveDivider(direction)
      else if (paneShown) panes.moveDivider(direction)
      return
    }
    if (panes.focused && paneShown) {
      panes.moveDivider(direction)
      return
    }
    if (railShown) rails.moveDivider(direction)
    else if (paneShown) panes.moveDivider(direction)
  }

  const listener = (data: string): { consume: boolean } | undefined => {
    config.debug(`input ${JSON.stringify(data)} active=${String(panes.focused)} overlays=${overlays.open}`)
    // A modal owns the keyboard: its own keys (the Session picker's search, an
    // approval's y/n) must not also drive the columns behind it.
    if (overlays.open > 0) return undefined

    // The exit key, in the slot pi gives `Ctrl-D`. It always answers, and the
    // shutdown asks a dirty editor before leaving.
    if (matchesKey(data, 'ctrl+q')) {
      quit()
      return { consume: true }
    }

    // Show or put away the conversation column. The composer is hidden with it,
    // so this has to answer from the rail and the editor as well; the two side
    // columns are the only way back and the only reason the frame stays usable.
    if (matchesKey(data, 'ctrl+d')) {
      toggleConversation()
      return { consume: true }
    }

    // The dividers from the keyboard. The key names the divider's direction, and
    // the divider that answers is the one on the focused column's left: a focused
    // pane moves its own rule, the conversation moves the rail's rule beside it,
    // and the rail - which has no column to its left - moves its own. A candidate
    // that is not painted falls back to the other.
    //
    // Two modifier families, because a terminal can only report what its encoding
    // allows. `Ctrl-Shift-←/→` are plain CSI sequences, so every terminal
    // reports them; `Ctrl-Shift-[ / ]` and `Cmd-Ctrl-[ / ]` need the extended
    // keyboard report, which the client asks for on start - a terminal without it
    // collapses the bracket chords onto `Esc` and `Ctrl-]`, which are the frame's
    // own keys, so those spellings simply never arrive there. Arrow chords stay
    // out of the Command family on purpose: macOS claims `Cmd-Ctrl-←/→`
    // for spaces, so that pair can never be ours.
    if (
      matchesKey(data, 'ctrl+shift+left') ||
      matchesKey(data, 'ctrl+shift+[') ||
      matchesKey(data, 'ctrl+super+[')
    ) {
      // A release is swallowed with its press: a terminal that reports event
      // types must not resize twice for one keystroke.
      if (!isKeyRelease(data)) moveDivider(-1)
      return { consume: true }
    }
    if (
      matchesKey(data, 'ctrl+shift+right') ||
      matchesKey(data, 'ctrl+shift+]') ||
      matchesKey(data, 'ctrl+super+]')
    ) {
      if (!isKeyRelease(data)) moveDivider(1)
      return { consume: true }
    }

    // The rail owns the keyboard while it has focus. Only keys belonging to the
    // whole client are taken here; everything else falls through to
    // `SessionRail.handleInput` (filter typing, `n`, `r`, arrows).
    if (rails.focused) {
      if (matchesKey(data, 'ctrl+g')) {
        rails.toggle()
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+t')) {
        // Leaving the rail first keeps its focus flag in step with the keyboard.
        rails.blur()
        panes.toggle('terminal', session.cwd)
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+f')) {
        rails.blur()
        panes.toggle('editor', session.cwd)
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+]')) {
        rails.blur()
        return { consume: true }
      }
      if (isEscapeInput(data)) {
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
      if (matchesKey(data, 'ctrl+c')) {
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

    // While a column has focus every key belongs to its program except the
    // column keys; anything else consumed here would be stolen from the program.
    if (panes.focused) {
      if (matchesKey(data, 'ctrl+[')) {
        if (panes.ownsEscape()) return undefined
        // Neovim still gets the key so its normal-mode `<esc>` mapping (clear the
        // search highlight) runs. The shell does not: readline would keep the key
        // pending as a meta prefix for whatever is typed next.
        if (panes.visible === 'editor') panes.input('\u001b')
        panes.blur()
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+t')) {
        panes.toggle('terminal', session.cwd)
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+f')) {
        panes.toggle('editor', session.cwd)
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+g')) {
        // The rail is a column, not the program's: a painted rail is put away
        // while the program keeps the keyboard, and a hidden one is shown and
        // takes it, so focus has to leave the program first.
        if (layout.railShown) rails.toggle()
        else {
          panes.blur()
          rails.toggle()
        }
        return { consume: true }
      }
      return undefined
    }

    // Esc is the interrupt key, as in pi's `app.interrupt`: it aborts the running
    // turn, and on an empty idle composer a second press opens the Session
    // picker. The completion menu keeps the first press for closing itself, and a
    // focused column keeps the byte while it has something to cancel (above),
    // because `Ctrl-[` and `Esc` are the same key.
    if (isEscapeInput(data)) {
      // Kitty-protocol key releases repeat the code without a new press.
      if (isKeyRelease(data)) return { consume: true }
      if (editor.completionMenuOpen) return undefined
      if (reducer.busy) {
        void commands.cancel()
        return { consume: true }
      }
      // The leftward move wins while the rail is on screen, draft or not: the
      // draft survives (blurring does not clear the composer) and Esc has no
      // other job here. It also works before the first Session has opened — the
      // list is already painted, and Enter on a row opens one. With the rail put
      // away, the old double-Esc picker stays available on an empty composer.
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
    if (matchesKey(data, 'ctrl+]')) {
      const kind = panes.switchable()
      if (kind !== undefined) {
        panes.focus(kind, session.cwd)
        return { consume: true }
      }
      // Nothing to switch to: the key stays the composer's word jump.
      return undefined
    }
    // pi's `app.message.dequeue`: pull everything the running turn has not
    // claimed back into the composer. Like pi it always answers, so an empty
    // queue says so instead of swallowing the key.
    if (matchesKey(data, 'alt+up')) {
      void commands.dequeue()
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+l')) {
      render.request(true)
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+o')) {
      view.toggleExpandAll()
      render.repaint()
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+t')) {
      panes.toggle('terminal', session.cwd)
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+f')) {
      panes.toggle('editor', session.cwd)
      return { consume: true }
    }
    // Show or put away the session rail. The key is a visibility toggle and
    // nothing else: a rail already on screen goes away even though the composer
    // has the keyboard, and one that is hidden comes back with the keyboard on
    // the list so it is usable straight away. Moving between columns is
    // `Ctrl-[` / `Ctrl-]`.
    if (matchesKey(data, 'ctrl+g')) {
      rails.toggle()
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+c')) {
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
  ],
  apply,
}
