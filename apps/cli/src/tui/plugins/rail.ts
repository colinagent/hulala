/**
 * The Session rail: the left column, its filter, its fold state and its clock.
 *
 * The rail owns no Session data — it renders the list the session plugin keeps
 * and asks it to open a row. What it does own is the part that is genuinely its
 * own: which directory's `More` row was taken, whether everything is expanded,
 * the current filter, and whether the keyboard is inside it.
 *
 * Its clock is the reason it is a plugin rather than a view: a running Session
 * animates at ten frames a second and an idle one needs a tick per second to
 * keep relative times honest, so there is a timer whose interval changes with
 * the content. That timer is an effect, so a window that ends for any reason
 * stops it.
 *
 * @module hulala-cli/tui/plugins/rail
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionRail, railLists } from '../view/sessionRail.js'
import { columnRule } from '../view/splitDivider.js'
import { railFits, railWidthFor } from '../view/layout.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The left column: list, filter, fold state and clock. */
    hulalaRail: TuiRail
  }
}

/** What the client asks the rail for. */
export interface TuiRail {
  /** The keyboard is inside the rail. */
  readonly focused: boolean
  /** The rail is drawn at this terminal width. */
  readonly shown: boolean
  /**
   * `Ctrl-G`: land the keyboard on the list, or put it away.
   *
   * A visible rail without the keyboard is focused rather than hidden, so one
   * gesture always lands somewhere — this is the fallback entry when a terminal
   * or input method eats `Ctrl-[`.
   */
  toggle(): void
  /** Move the keyboard to the rail, showing it if it was hidden. */
  focus(): void
  /** Move the keyboard back to the composer; the rail stays visible. */
  blur(): void
  /** The rail's filter box has the keyboard, not the list. */
  readonly filterFocused: boolean
  /** One raw key event, while the rail owns the keyboard. */
  handleInput(data: string): void
  /** Re-decide the repaint cadence (called after a geometry change). */
  sync(): void
}

/** Colour flag, the closing predicate, and the notice sink. */
export interface RailPluginConfig {
  readonly color: boolean
  /** Whether the window is closing; the rail refuses to take focus then. */
  isClosing: () => boolean
}

/** Provide the left column. */
export function apply(ctx: Context, config: RailPluginConfig): void {
  const render = ctx.hulalaRender
  const layout = ctx.hulalaLayout
  const session = ctx.hulalaSession
  const { terminal, screen } = ctx.hulalaTerminal
  const { reducer } = ctx.hulalaViewModel
  const composer = ctx.hulalaComposer

  let focused = false
  let query = ''
  let allExpanded = false
  /** The current directory's `More` row was taken; reset when that directory changes. */
  let revealed = false
  let timer: ReturnType<typeof setInterval> | undefined
  let timerMs = 0
  let lastCwd = session.cwd

  const pageRows = (): number => Math.max(1, (terminal.rows - 1) - 4)

  const rail = new SessionRail({
    state: () => ({
      sessions: session.sessions,
      cwd: session.cwd,
      currentId: session.id,
      query,
      allExpanded,
      revealed,
      // Rows between the header and the `all` row, minus the `+ 新会话` row.
      pageRows: pageRows(),
      now: Date.now(),
    }),
    rows: () => Math.max(4, terminal.rows - 1),
    color: config.color,
    focused: () => focused,
    onOpen: id => { void session.open(id).finally(() => blur()) },
    onNew: () => { void session.startNew().finally(() => blur()) },
    onQuery: (next: string) => { query = next; render.request() },
    onAllExpanded: (expanded: boolean) => { allExpanded = expanded; syncTimer(); render.request() },
    onRevealed: (next: boolean) => { revealed = next; render.request() },
    onRefresh: () => { void session.refresh() },
  })
  const divider = columnRule(() => Math.max(1, terminal.rows - 1), config.color)

  layout.register('rail', {
    id: 'sessions',
    component: rail,
    divider,
    width: () => railWidthFor(terminal.columns),
  })

  const shown = (): boolean => layout.railShown

  const hasRunning = (): boolean => {
    if (!shown()) return false
    const lists = railLists({
      sessions: session.sessions,
      cwd: session.cwd,
      currentId: session.id,
      query,
      allExpanded,
      revealed,
      pageRows: pageRows(),
      now: 0,
    })
    return [...lists.current, ...lists.foreign].some(row => row.running)
  }

  /**
   * Repaint cadence for the rail.
   *
   * A running Session animates at ten frames a second; otherwise the rail only
   * needs the relative-time labels to stay current, which is a one-second tick.
   * Nothing ticks while the rail is put away.
   */
  const syncTimer = (): void => {
    const wanted = shown() ? (hasRunning() ? 100 : 1_000) : undefined
    if (wanted === undefined) {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      timerMs = 0
      return
    }
    if (timer !== undefined && timerMs === wanted) return
    if (timer !== undefined) clearInterval(timer)
    timerMs = wanted
    timer = setInterval(() => { render.request() }, wanted)
  }

  const blur = (): void => {
    if (!focused) return
    focused = false
    query = ''
    screen.setFocus(composer.editor)
    render.request()
  }

  const focus = (): void => {
    if (config.isClosing()) return
    if (!railFits(terminal.columns, layout.paneId !== undefined)) {
      reducer.addNotice('the Session rail needs a wider terminal; close the editor column first')
      render.repaint()
      return
    }
    focused = true
    query = ''
    rail.startEditing(session.id)
    layout.setRailVisible(true)
    screen.setFocus(rail)
    syncTimer()
    render.request()
  }

  const toggle = (): void => {
    if (config.isClosing()) return
    if (!layout.railWanted || !focused) {
      focus()
      return
    }
    focused = false
    query = ''
    layout.setRailVisible(false)
    screen.setFocus(composer.editor)
    syncTimer()
    render.request()
  }

  // A geometry change can take the rail's columns away; the keyboard must not
  // stay on a column that is no longer painted.
  layout.onChange(() => {
    if (focused && !layout.railShown) {
      focused = false
      screen.setFocus(composer.editor)
    } else if (focused) {
      screen.setFocus(rail)
    }
    syncTimer()
  })

  // The rail's cursor follows the open Session, and its fold state is per
  // directory: a Session that moved somewhere else starts collapsed again.
  ctx.on('hulala/session-opened', id => {
    blur()
    rail.selectCurrent(id)
    if (lastCwd !== session.cwd) revealed = false
    lastCwd = session.cwd
    syncTimer()
    render.request()
  })
  ctx.on('hulala/session-changed', () => {
    rail.selectCurrent(session.id)
    syncTimer()
  })

  render.onSync(syncTimer)

  ctx.effect(() => () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    timerMs = 0
  }, 'hulala: rail clock')

  ctx.provide('hulalaRail', {
    get focused() { return focused },
    get shown() { return shown() },
    get filterFocused() { return rail.filterFocused },
    toggle,
    focus,
    blur,
    handleInput: (data: string) => { rail.handleInput(data) },
    sync: syncTimer,
  })
}

/** Cordis object-form plugin. */
export const railPlugin = {
  name: 'hulala-rail',
  inject: ['hulalaRender', 'hulalaLayout', 'hulalaSession', 'hulalaTerminal', 'hulalaViewModel', 'hulalaComposer'],
  apply,
}
