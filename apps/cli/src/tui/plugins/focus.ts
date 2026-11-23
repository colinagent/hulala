/**
 * Which panel owns the keyboard, and the one way a click moves it there.
 *
 * The frame has three surfaces that read a keystroke: the conversation's
 * composer, the Session rail, and the column (`Ctrl-T`'s terminal or `Ctrl-D`'s
 * Neovim). Two of them already know how to take the keyboard for themselves —
 * `rail.focus()` starts the list's editing state, `panes.focus()` starts or
 * adopts a column and passes the caret through — but neither knows how to let go
 * without also saying where focus goes next. `blur()` is "back to the composer",
 * which is the right answer for `Esc` and the wrong one for a click: a
 * conversation put away on purpose with `Shift-Cmd-C` must not reappear just
 * because the pointer moved from the rail to a column.
 *
 * So this plugin is the arbitration, not a second owner. The flags stay where
 * they were (`rail.focused`, `panes.focused`; the composer is the absence of
 * both, because it is the keyboard's home), the panels keep their own release
 * steps, and the mouse handlers only name the panel the pointer hit.
 *
 * A modal, and a selector that has taken the composer's slot, are keyboard owners
 * above all of this: while one is up, a click behind it changes nothing.
 *
 * @module hulala-cli/tui/plugins/focus
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PaneKind } from '../pane/focus.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The one panel that holds the keyboard, and how focus moves between them. */
    hulalaFocus: TuiFocus
  }
}

/** The surfaces a keystroke can land in. */
export type FocusPanel = 'composer' | 'rail' | 'pane'

/** What the pointer and the client ask for when focus changes. */
export interface TuiFocus {
  /** The panel the next keystroke reaches. */
  readonly panel: FocusPanel
  /**
   * A modal owns the keyboard, so no panel is the current one.
   *
   * Every column draws faint while this is true: a dialog is the only surface
   * the user can act on, and the frame says so the same way it already says
   * which column has the keyboard. `panel` still names where the keyboard was,
   * which is where it goes back when the dialog closes.
   */
  readonly modal: boolean
  /** Give the keyboard to the composer, which is the conversation's panel. */
  composer(): void
  /** Give the keyboard to the Session rail, showing it if it was hidden. */
  rail(): void
  /** Give the keyboard to a column that is already painted. */
  pane(kind: PaneKind): void
}

/** Provide the arbitration. */
export function apply(ctx: Context): void {
  const { focus: focusOn } = ctx.hulalaTerminal
  const layout = ctx.hulalaLayout
  const render = ctx.hulalaRender
  const overlays = ctx.hulalaOverlays
  // Read lazily: the rail, the columns and the composer are applied in that
  // order, and a mouse handler can only fire once all of them exist.
  const panes = () => ctx.get('hulalaPanes')
  const rail = () => ctx.get('hulalaRail')
  const composer = () => ctx.get('hulalaComposer')?.editor

  /** A modal owns the keyboard while it is up; a click behind it changes nothing. */
  const blocked = (): boolean =>
    overlays.open > 0 || ctx.get('hulalaComposer')?.slot.replaced === true

  /**
   * Let the panels that are not the new owner drop their claim.
   *
   * The composer has no release of its own: its "focus" is a component focus set
   * by the next owner, and a hidden one has nowhere to put a cursor.
   * @param keep - the panel taking the keyboard.
   */
  const release = (keep: FocusPanel): void => {
    if (keep !== 'pane') panes()?.unfocus()
    if (keep !== 'rail') rail()?.unfocus()
  }

  const toComposer = (): void => {
    if (blocked()) return
    release('composer')
    const editor = composer()
    if (editor === undefined) return
    // The composer is the keyboard's home, so it has to be on screen to take it
    // back; a frame built for `Ctrl-Shift-D` may have the conversation put away.
    if (!layout.conversationShown) layout.setConversationVisible(true)
    focusOn(editor)
    render.request()
  }

  const toRail = (): void => {
    if (blocked()) return
    const sessions = rail()
    // Clicking the panel that already has the keys is not a state change: the
    // list's cursor and an open filter must survive it.
    if (sessions === undefined || sessions.focused) return
    release('rail')
    sessions.focus()
  }

  const toPane = (kind: PaneKind): void => {
    if (blocked()) return
    const columns = panes()
    // The painted column is the only one that can be clicked, and it is the one
    // that already has the keys when it is focused.
    if (columns === undefined || columns.focused) return
    release('pane')
    columns.refocus(kind)
  }

  ctx.provide('hulalaFocus', {
    get panel(): FocusPanel {
      if (panes()?.focused === true) return 'pane'
      if (rail()?.focused === true) return 'rail'
      return 'composer'
    },
    get modal(): boolean {
      return overlays.open > 0
    },
    composer: toComposer,
    rail: toRail,
    pane: toPane,
  })
}

/** Cordis object-form plugin. */
export const focusPlugin = {
  name: 'hulala-focus',
  inject: ['hulalaTerminal', 'hulalaLayout', 'hulalaRender', 'hulalaOverlays'],
  apply,
}
