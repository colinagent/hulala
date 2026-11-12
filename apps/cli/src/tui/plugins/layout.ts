/**
 * The frame: which columns exist, how wide they are, and who owns the keyboard.
 *
 * The terminal is a fixed cell grid, so the client only ever has a handful of
 * shapes — conversation alone; rail beside it; a program column beside it; or
 * all three. This plugin is the one place that knows those four shapes and the
 * narrow-terminal rules that choose between them, which is why every column
 * registers a *seat* here instead of assembling the tree itself.
 *
 * That indirection is the point. Before it, the frame builder had to name the
 * rail, the panes, the composer and the dock directly, so any feature that
 * wanted a column had to be known by the frame — and the frame had to be known
 * by that feature. A seat reverses it: the frame knows only "the rail seat", and
 * whoever fills it can be replaced, removed or written by a plugin.
 *
 * Seats are the terminal analogue of DSH's UI slots, deliberately narrower:
 * terminal layout is constrained (see `view/layout.ts` for the minimums a
 * conversation, a rail and a pane need), so a seat declares content, never
 * geometry.
 *
 * @module hulala-cli/tui/plugins/layout
 */
import type { Context } from '@deepseek-ai/cordis'
import { VStack, type Component, type ScrollView } from '@earendil-works/pi-tui'
import type { SeatId } from '../types.js'
import {
  buildRailTerminalLayout,
  buildSideColumnsLayout,
  buildSplitTerminalLayout,
  buildTerminalLayout,
  RAIL_MIN_SIZE,
  railFits,
  railWidthFor,
  railWidthLimit,
  SPLIT_MIN_SIZE,
} from '../view/layout.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The frame's seats and column geometry. */
    hulalaLayout: TuiLayout
  }
}

export type { SeatId }

/** A component in a seat, with no say over its size. */
export interface SeatEntry {
  /** Stable name, used to replace or remove exactly this entry. */
  readonly id: string
  readonly component: Component
}

/** A column seat: content plus its own width policy and drag target. */
export interface ColumnSeatEntry extends SeatEntry {
  /** Column width in cells at the current terminal size. */
  readonly width: () => number
  /** One-column target the pointer drags to resize the column. */
  readonly divider: Component
  /** The pointer left the divider for the conversation. */
  readonly onConversationPointer?: () => void
  /** The user dragged the divider; the column owns whatever ratio results. */
  readonly onResize?: (width: number) => void
}

/** What a feature uses to occupy the frame. */
export interface TuiLayout {
  /**
   * Put a component in a seat, replacing any entry with the same id.
   * @param seat - the seat to fill.
   * @param entry - the component, or `undefined` to vacate the seat.
   * @returns idempotent removal.
   */
  register(seat: SeatId, entry: SeatEntry | ColumnSeatEntry | undefined): () => void
  /** Ask for the rail. Whether it fits is decided at rebuild time. */
  setRailVisible(visible: boolean): void
  /** The rail is asked for. Not the same as being drawn. */
  readonly railWanted: boolean
  /** The rail is drawn at this width. */
  readonly railShown: boolean
  /**
   * Show the conversation column, or put it away with `Shift-Cmd-C`.
   *
   * A hidden conversation is refused while neither side column is drawn: the
   * frame never becomes empty. The seat registrations stay in place, so
   * revealing the conversation restores the same transcript, composer and
   * draft.
   * @param visible - whether the conversation should be drawn.
   */
  setConversationVisible(visible: boolean): void
  /** The conversation is asked for. */
  readonly conversationWanted: boolean
  /** The conversation is drawn; always true when both side columns are away. */
  readonly conversationShown: boolean
  /** Show a registered column seat as the right column, or clear it. */
  setPane(id: string | undefined): void
  /** The right column currently drawn, if any. */
  readonly paneId: string | undefined
  /** Rebuild the frame tree from the registered seats. */
  rebuild(): void
  /** Resize the right column without rebuilding the tree. */
  resizePane(width: number): void
  /** The width the rail is drawn at, in cells. */
  readonly railWidth: number
  /** The column the rail divider is drawn in. */
  readonly railDividerColumn: number
  /** End every divider's hover state, e.g. when the pointer entered a column. */
  clearDividerHover(): void
  /**
   * Move the rail divider by a number of cells.
   *
   * Positive moves the boundary right, negative left, so a pointer drag reports
   * the distance from where the rule is now and the keyboard reports one step.
   * The request is clamped to the rail's bounds, so a drag cannot squeeze the
   * conversation or the pane away. With the conversation put away the rail is the
   * flexible column and the pane owns the width, so the same step resizes there.
   * @param delta - cells to move the boundary, positive to the right.
   */
  moveRailDivider(delta: number): void
  /**
   * Subscribe to a rebuild, after the tree is installed.
   * @param listener - runs on the next and every later rebuild.
   * @returns idempotent unsubscribe.
   */
  onChange(listener: () => void): () => void
}

const REQUIRED: ReadonlyArray<SeatId> = ['main', 'dock.input', 'dock.status']

/**
 * Seats that belong to exactly one owner.
 *
 * A second registration is an error rather than a silent replacement: two plugins
 * both claiming the transcript would leave one of them mysteriously absent, and
 * two claiming the composer would fight over the user's keystrokes.
 */
const EXCLUSIVE: ReadonlySet<SeatId> = new Set<SeatId>(['main', 'dock.cwd', 'dock.input', 'rail', 'pane'])

// Everything not in `EXCLUSIVE` stacks, which is `dock.pending` and
// `dock.status`: multiple owners' rows are drawn in registration order.

/** Provide the frame. */
export function apply(ctx: Context): void {
  const { screen, terminal } = ctx.hulalaTerminal
  const render = ctx.hulalaRender
  // Per seat, an ordered map of id → entry. Exclusive seats hold one entry;
  // every other seat renders every entry, top to bottom.
  const seats = new Map<SeatId, Map<string, SeatEntry | ColumnSeatEntry>>()
  const listeners = new Set<() => void>()
  let railWanted = true
  let railShown = false
  let conversationWanted = true
  let conversationShown = true
  let paneId: string | undefined
  // The frame in use when there are side columns; `setPaneWidth` is the only
  // part of either builder the layout needs after the tree is installed.
  let split: { readonly root: Component; setPaneWidth(width: number): void; readonly transcriptScroll?: ScrollView } | undefined
  /** The rail width a drag asked for; the default share until one happens. */
  let railWidthWanted: number | undefined
  /** The transcript viewport, kept across rebuilds so a drag does not scroll away. */
  let transcriptScroll: ScrollView | undefined

  /**
   * The width asked of the rail at this terminal width.
   *
   * The width the frame draws is one cell narrower, so the limit it must stay
   * under is the drawn limit plus that cell.
   */
  const railWidthNow = (withPane: boolean): number => {
    const wanted = railWidthWanted ?? railWidthFor(terminal.columns)
    const limit = railWidthLimit(terminal.columns, withPane) + 1
    return Math.min(limit, Math.max(RAIL_MIN_SIZE, Math.round(wanted)))
  }

  /** The pane's content width, as its seat asks for it. */
  const paneWidthNow = (): number => {
    const pane = column('pane')
    return pane === undefined ? 0 : Math.max(SPLIT_MIN_SIZE, Math.round(pane.width()))
  }

  /** The width the rail is drawn at: the cell it asks for, minus its rule's gap. */
  const railDrawnWidthNow = (): number => Math.max(RAIL_MIN_SIZE, railWidthNow(paneId !== undefined) - 1)

  const railDividerColumnNow = (): number => {
    if (!conversationShown) return terminal.columns - paneWidthNow() - 1
    // The rule is the gap column after the rail's cell, which the builder keeps
    // at `railWidth - 1` but never below the rail's own minimum.
    return railDrawnWidthNow() + 1
  }

  /**
   * Move the rail divider by a number of cells.
   *
   * With the conversation on screen the rail trades width with it: the step is
   * clamped, remembered and laid out again, and the transcript viewport is reused
   * across the rebuild so the reader keeps their place. With the conversation put
   * away there is no rail width to trade, so the step belongs to the pane seat.
   * @param delta - cells to move the boundary, positive to the right.
   */
  const moveRailDivider = (delta: number): void => {
    const step = Math.round(delta)
    if (step === 0) return
    if (!conversationShown) {
      // The rail absorbs the leftover width here, so the rule beside it is the
      // pane's right edge: moving the rule by a cell takes a cell from the pane.
      const pane = column('pane')
      if (pane === undefined) return
      const width = paneWidthNow() - step
      if (pane.onResize === undefined) split?.setPaneWidth(width)
      else pane.onResize(width)
      render.request()
      return
    }
    const withPane = paneId !== undefined
    // The step starts from the rule's own column, not from the width it asks for:
    // the two differ by the gap cell the rail's width already counts, and the rule
    // has to land under the pointer that dragged it.
    const next = Math.min(
      railWidthLimit(terminal.columns, withPane) + 1,
      Math.max(RAIL_MIN_SIZE, railDividerColumnNow() + step),
    )
    if (next === railWidthNow(withPane)) return
    railWidthWanted = next
    rebuild()
  }

  const entriesOf = (seat: SeatId): Array<SeatEntry | ColumnSeatEntry> => [...(seats.get(seat)?.values() ?? [])]

  /** The one entry an exclusive seat holds, if any. */
  const only = (seat: SeatId): (SeatEntry | ColumnSeatEntry) | undefined => entriesOf(seat)[0]

  /** A seat's content: its single entry, or every stacked entry in order. */
  const contentOf = (seat: SeatId): Component | undefined => {
    const entries = entriesOf(seat)
    if (entries.length === 0) return undefined
    if (entries.length === 1) return entries[0]!.component
    return new VStack(entries.map(entry => ({ component: entry.component, shrink: 1, minSize: 0 })))
  }

  const column = (seat: SeatId): ColumnSeatEntry | undefined => {
    const entry = only(seat)
    return entry !== undefined && 'divider' in entry ? entry : undefined
  }

  /**
   * End every divider's hover state.
   *
   * A divider is its own layout cell, so the pointer entering any column means
   * the pointer is no longer on a rule. Columns report their own pointer events
   * and the frame fans that out, because a column has no business knowing which
   * rules sit beside it.
   */
  const clearDividerHover = (): void => {
    column('rail')?.onConversationPointer?.()
    column('pane')?.onConversationPointer?.()
  }

  const rebuild = (): void => {
    const rail = column('rail')
    const pane = column('pane')
    const paneShown = paneId === undefined ? undefined : pane
    const railWidth = railWidthNow(paneShown !== undefined)
    railShown = railWanted && rail !== undefined && railFits(terminal.columns, paneShown !== undefined, railWidth)
    // A drag rebuilds the tree; the viewport is reused so the transcript keeps
    // the reader's position instead of jumping back to the end.
    const scroll = transcriptScroll === undefined ? {} : { scroll: transcriptScroll }
    // One column always stays: a conversation put away while both side columns
    // are gone would leave an empty frame and a keyboard with nowhere to go.
    conversationShown = conversationWanted || (!railShown && paneShown === undefined)

    const statusBar = contentOf('dock.status')
    if (statusBar === undefined) return
    if (conversationShown) {
      for (const seat of REQUIRED) {
        if (contentOf(seat) === undefined) return
      }
    }

    if (!conversationShown) {
      split = buildSideColumnsLayout({
        ...(railShown
          ? { rail: { component: rail!.component, divider: rail!.divider, width: railWidth } }
          : {}),
        ...(paneShown === undefined
          ? {}
          : { pane: { component: paneShown.component, divider: paneShown.divider, width: Math.max(SPLIT_MIN_SIZE, Math.round(paneShown.width())) } }),
        statusBar,
      })
      screen.setLayoutRoot(split.root)
    } else {
      const main = contentOf('main')!
      const pending = contentOf('dock.pending')
      const cwdBar = contentOf('dock.cwd')
      const editor = contentOf('dock.input')!

      // A seat that is optional still has to render something in the dock shape,
      // and pi-tui takes the component, so an absent pending row is a zero-row
      // spacer rather than a special case in the builder.
      const pendingOrBlank = pending ?? BLANK

      if (paneShown !== undefined) {
        split = railShown
          ? buildRailTerminalLayout({
              transcript: main,
              pending: pendingOrBlank,
              editor,
              statusBar,
              rail: rail!.component,
              railWidth,
              railDivider: rail!.divider,
              ...scroll,
              onConversationPointer: clearDividerHover,
              pane: {
                component: paneShown.component,
                width: Math.max(SPLIT_MIN_SIZE, Math.round(paneShown.width())),
                divider: paneShown.divider,
                onConversationPointer: clearDividerHover,
              },
            })
          : buildSplitTerminalLayout({
              transcript: main,
              pending: pendingOrBlank,
              // The rail carries the path; only a rail-less frame needs the row.
              ...(cwdBar === undefined ? {} : { cwdBar }),
              editor,
              statusBar,
              pane: paneShown.component,
              divider: paneShown.divider,
              paneWidth: Math.max(SPLIT_MIN_SIZE, Math.round(paneShown.width())),
              onConversationPointer: clearDividerHover,
              ...scroll,
            })
      } else if (railShown) {
        split = buildRailTerminalLayout({
          transcript: main,
          pending: pendingOrBlank,
          editor,
          statusBar,
          rail: rail!.component,
          railWidth,
          railDivider: rail!.divider,
          onConversationPointer: clearDividerHover,
          ...scroll,
        })
      } else {
        split = undefined
        const plain = buildTerminalLayout({
          transcript: main,
          pending: pendingOrBlank,
          ...(cwdBar === undefined ? {} : { cwdBar }),
          editor,
          statusBar,
          ...scroll,
        })
        transcriptScroll = plain.transcriptScroll
        screen.setLayoutRoot(plain.root)
      }
      if (split !== undefined) screen.setLayoutRoot(split.root)
    }
    if (split?.transcriptScroll !== undefined) transcriptScroll = split.transcriptScroll
    for (const listener of listeners) listener()
    render.request(true)
  }

  const register = (seat: SeatId, entry: SeatEntry | ColumnSeatEntry | undefined): (() => void) => {
    if (entry === undefined) {
      seats.delete(seat)
      rebuild()
      return () => undefined
    }
    const held = seats.get(seat) ?? new Map<string, SeatEntry | ColumnSeatEntry>()
    if (EXCLUSIVE.has(seat)) {
      const occupant = [...held.values()][0]
      if (occupant !== undefined && occupant.id !== entry.id) {
        // Refuse rather than replace: a silently displaced plugin looks like a
        // plugin that never loaded, and the user has no way to tell why.
        throw new Error(`the "${seat}" seat is already taken by "${occupant.id}"`)
      }
      seats.set(seat, new Map([[entry.id, entry]]))
    } else {
      // Re-registering the same id replaces it in place, keeping the order the
      // stacked seat draws in.
      seats.set(seat, new Map([...held, [entry.id, entry]]))
    }
    rebuild()
    return () => {
      const current = seats.get(seat)
      if (current?.get(entry.id) !== entry) return
      current.delete(entry.id)
      if (current.size === 0) seats.delete(seat)
      rebuild()
    }
  }

  ctx.effect(() => () => {
    seats.clear()
    listeners.clear()
  }, 'hulala: layout seats')

  ctx.provide('hulalaLayout', {
    register,
    setRailVisible: (visible: boolean) => {
      if (railWanted === visible) return
      railWanted = visible
      rebuild()
    },
    get railWanted() { return railWanted },
    get railShown() { return railShown },
    setConversationVisible: (visible: boolean) => {
      if (conversationWanted === visible) return
      // Refuse the request itself, not just this rebuild: keeping it would hide
      // the conversation the moment a side column appeared, which is not what
      // the key meant while nothing was open.
      if (!visible && !railShown && paneId === undefined) return
      conversationWanted = visible
      rebuild()
    },
    get conversationWanted() { return conversationWanted },
    get conversationShown() { return conversationShown },
    setPane: (id: string | undefined) => {
      if (paneId === id) return
      paneId = id
      rebuild()
    },
    get paneId() { return paneId },
    rebuild,
    resizePane: (width: number) => { split?.setPaneWidth(width) },
    get railWidth() { return railDrawnWidthNow() },
    get railDividerColumn() { return railDividerColumnNow() },
    moveRailDivider,
    clearDividerHover,
    onChange: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })
}

/** Stands in for an absent optional dock row: it renders nothing, at no height. */
const BLANK: Component = { render: () => [], invalidate: () => undefined }

/** Cordis object-form plugin. */
export const layoutPlugin = { name: 'hulala-layout', inject: ['hulalaTerminal', 'hulalaRender'], apply }
