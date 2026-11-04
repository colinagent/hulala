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
import { VStack, type Component } from '@earendil-works/pi-tui'
import type { SeatId } from '@hulala/plugin-sdk'
import {
  buildRailTerminalLayout,
  buildSideColumnsLayout,
  buildSplitTerminalLayout,
  buildTerminalLayout,
  railFits,
  railWidthFor,
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
   * Show the conversation column, or put it away with `Ctrl-D`.
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
  let split: { readonly root: Component; setPaneWidth(width: number): void } | undefined

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

  const rebuild = (): void => {
    const rail = column('rail')
    const pane = column('pane')
    const paneShown = paneId === undefined ? undefined : pane
    railShown = railWanted && rail !== undefined && railFits(terminal.columns, paneShown !== undefined)
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
          ? { rail: { component: rail!.component, divider: rail!.divider, width: railWidthFor(terminal.columns) } }
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
              railWidth: railWidthFor(terminal.columns),
              railDivider: rail!.divider,
              pane: {
                component: paneShown.component,
                width: Math.max(SPLIT_MIN_SIZE, Math.round(paneShown.width())),
                divider: paneShown.divider,
                onConversationPointer: () => paneShown.onConversationPointer?.(),
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
              onConversationPointer: () => paneShown.onConversationPointer?.(),
            })
      } else if (railShown) {
        split = buildRailTerminalLayout({
          transcript: main,
          pending: pendingOrBlank,
          editor,
          statusBar,
          rail: rail!.component,
          railWidth: railWidthFor(terminal.columns),
          railDivider: rail!.divider,
        })
      } else {
        split = undefined
        screen.setLayoutRoot(buildTerminalLayout({
          transcript: main,
          pending: pendingOrBlank,
          ...(cwdBar === undefined ? {} : { cwdBar }),
          editor,
          statusBar,
        }).root)
      }
      if (split !== undefined) screen.setLayoutRoot(split.root)
    }
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
