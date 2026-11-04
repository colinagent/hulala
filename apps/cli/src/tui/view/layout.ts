/**
 * Fullscreen terminal layout: the transcript viewport above the fixed input
 * dock.
 *
 * This is pi's `createChatViewport` shape, and it matters for correctness as
 * much as for looks: hulala's transcript is a `ScrollView` whose unconstrained
 * height is the whole conversation, so a stack that let it advertise that
 * height would shrink every sibling whenever the conversation grew past the
 * terminal. That is how the composer's bottom rule and the status bar used to
 * disappear once a Session had a few turns — leaving the `❯` arrow sitting
 * outside what was left of the input box.
 *
 * Giving the transcript `basis: 0` with `grow: 1` means it only ever receives
 * the height nobody else claimed, and the dock keeps the composer at its
 * intrinsic height. The dock's own `minSize` values protect the composer's
 * top rule, input line and bottom rule even on a very short terminal; its
 * neighbours are the ones that give way.
 *
 * @module hulala-cli/tui/view/layout
 */
import {
  HStack,
  ScrollView,
  VStack,
  type Component,
  type TuiMouseEvent,
} from '@earendil-works/pi-tui'


export interface TerminalLayoutOptions {
  readonly transcript: Component
  /** Pending inbox rows directly above the composer; empty renders no lines. */
  readonly pending: Component
  /**
   * Working-directory row above the composer. Omitted while the session rail is
   * painted: the rail's header already carries the path, so the dock does not
   * spend a row repeating it.
   */
  readonly cwdBar?: Component
  readonly editor: Component
  readonly statusBar: Component
}

/** The dock entries shared by every layout, with the optional directory row. */
function chatEntries(options: TerminalLayoutOptions): NonNullable<ConstructorParameters<typeof VStack>[0]> {
  return [
    { component: options.pending, shrink: 1, minSize: 0 },
    ...(options.cwdBar === undefined ? [] : [{ component: options.cwdBar, shrink: 1, minSize: 0 }]),
  ]
}

/**
 * A fixed-width blank column.
 *
 * The status row is not part of any column: it belongs to the client and keeps
 * the model at the frame's right edge, but its readings must start under the
 * conversation rather than under the Session rail. A blank column of the rail's
 * width is what turns one full-width row into that alignment.
 */
class BlankColumn implements Component {
  invalidate(): void {}
  render(width: number): string[] {
    return [' '.repeat(Math.max(0, width))]
  }
}

/**
 * The frame's bottom rule: the composer's own bottom line, continued.
 *
 * Every column ends on this one line and the vertical dividers stop on it, so
 * the columns read as panes of one window rather than three stacked boxes. It is
 * drawn with the same dim styling the composer's border uses, which is what
 * makes the conversation's segment and the others look like one line.
 */
class BottomRule implements Component {
  invalidate(): void {}
  render(width: number): string[] {
    return [`\u001b[2m${'\u2500'.repeat(Math.max(0, width))}\u001b[0m`]
  }
}

/**
 * A column with the frame's bottom rule under it.
 *
 * The rule has to sit on one row across the frame, so each column reserves that
 * row for itself instead of letting its content run to the last line. The
 * conversation needs no wrapper: its composer already draws the segment.
 */
class RuledColumn implements Component {
  constructor(private readonly body: Component, private readonly rule: Component) {}
  invalidate(): void {
    this.body.invalidate()
    this.rule.invalidate()
  }
  render(width: number): string[] {
    return [...this.body.render(width), ...this.rule.render(width)]
  }
}

/** Left column that reports pointer presence while keeping normal mouse routing. */
class ConversationColumn extends VStack {
  constructor(children: ConstructorParameters<typeof VStack>[0], private readonly onPointer: () => void) {
    super(children)
  }

  handleMouse(event: TuiMouseEvent) {
    this.onPointer()
    return super.handleMouse(event)
  }
}

export interface SplitTerminalLayoutOptions extends TerminalLayoutOptions {
  /** Right-hand editor pane, shown only while the user is editing. */
  readonly pane: Component
  /** Columns reserved for the editor, decided by the caller from the viewport. */
  readonly paneWidth: number
  /** One-column drag target between the two columns. */
  readonly divider: Component
  /** The pointer moved somewhere in the conversation column. */
  readonly onConversationPointer: () => void
}

export interface TerminalLayout {
  readonly root: Component
  readonly transcriptScroll: ScrollView
}

export interface SplitTerminalLayout extends TerminalLayout {
  /** Redraw the divider at a new editor width without rebuilding the tree. */
  setPaneWidth(paneWidth: number): void
}

/** One of the two columns that can outlive a hidden conversation. */
export interface SideColumn {
  readonly component: Component
  /** One-column rule the frame draws beside the column. */
  readonly divider: Component
  /** Width asked for; the pane keeps it while the rail takes the rest. */
  readonly width: number
}

/**
 * What is left when the conversation column is put away with `Ctrl-D`.
 *
 * There is no transcript to grow, so the columns that remain share the width
 * themselves: the pane keeps the width its divider was dragged to and the rail
 * absorbs everything else. With a single column there is nothing to divide and
 * that column simply fills the frame.
 */
export interface SideColumnsLayoutOptions {
  /** Left session rail; absent while it is put away or too wide to fit. */
  readonly rail?: SideColumn
  /** Right editor column; absent while it is closed. */
  readonly pane?: SideColumn
  readonly statusBar: Component
}

/** The column frame with no conversation, and the divider hook that survives it. */
export interface SideColumnsLayout {
  readonly root: Component
  /** Move the divider; a lone column has nothing to resize. */
  setPaneWidth(paneWidth: number): void
}

/** Right-hand editor column, present only while the editor is open. */
export interface RailPane {
  readonly component: Component
  readonly width: number
  readonly divider: Component
  readonly onConversationPointer: () => void
}

export interface RailLayoutOptions extends TerminalLayoutOptions {
  /** Left session rail and the rule separating it from the conversation. */
  readonly rail: Component
  readonly railWidth: number
  readonly railDivider: Component
  /** The editor column, when the sidebar is open beside the rail. */
  readonly pane?: RailPane
}

/** Rule above and below the composer plus the line that carries the arrow. */
const COMPOSER_MIN_SIZE = 3

/** Gap column between two columns. */
const SPLIT_GAP = 1

/** Narrowest column a side-by-side layout is allowed to shrink to. */
export const SPLIT_MIN_SIZE = 32

/** Narrowest the session rail is ever drawn; its share is `railWidthFor`. */
export const RAIL_MIN_SIZE = 18

/** Widest the session rail claims, so a wide terminal stays a conversation. */
export const RAIL_MAX_SIZE = 24

/** Narrowest conversation column when the rail is beside it. */
export const RAIL_CONVERSATION_MIN = 34

/**
 * Columns the session rail claims at a given terminal width.
 *
 * A fixed share rather than a fixed count: the rail is a reading aid, so it
 * stays narrow (18–24 columns) and gives the conversation the rest.
 * @param columns - terminal width.
 * @returns the rail's column count, clamped to the rail's own minimum/maximum.
 */
export function railWidthFor(columns: number): number {
  return Math.min(RAIL_MAX_SIZE, Math.max(RAIL_MIN_SIZE, Math.round(columns * 0.15)))
}

/**
 * Whether the rail leaves both neighbours their minimum width.
 * @param columns - terminal width.
 * @param withPane - the editor column is open too.
 * @returns true when the rail can be drawn without squeezing a neighbour.
 */
export function railFits(columns: number, withPane: boolean): boolean {
  if (columns < RAIL_MIN_SIZE + SPLIT_GAP + RAIL_CONVERSATION_MIN) return false
  if (!withPane) return true
  return columns >= railWidthFor(columns) + SPLIT_GAP + RAIL_CONVERSATION_MIN + SPLIT_GAP + SPLIT_MIN_SIZE
}

export function buildTerminalLayout(options: TerminalLayoutOptions): TerminalLayout {
  const transcriptScroll = new ScrollView(options.transcript, { follow: 'end', primary: true })

  const dock = new VStack([
    ...chatEntries(options),
    { component: options.editor, shrink: 1, minSize: COMPOSER_MIN_SIZE },
    { component: options.statusBar, shrink: 1, minSize: 0 },
  ])

  const root = new VStack([
    { component: transcriptScroll, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: dock, basis: 'auto', grow: 0, shrink: 1, minSize: 1 },
  ])

  return { root, transcriptScroll }
}

/**
 * Session rail, conversation, and the editor column when it is open.
 *
 * The rail is a real column rather than an overlay: it has to stay readable
 * while the composer is being typed into, and a floating panel would hide the
 * transcript it is used to switch. The status row runs the full width, but its
 * readings start under the conversation: the rail never owns the client's
 * footer.
 * @param options - the shared chat pieces, the rail, and the optional pane.
 * @returns the layout root, the transcript viewport, and the pane-width hook.
 */
export function buildRailTerminalLayout(options: RailLayoutOptions): SplitTerminalLayout {
  const transcriptScroll = new ScrollView(options.transcript, { follow: 'end', primary: true })

  const conversation = new ConversationColumn([
    { component: transcriptScroll, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    ...chatEntries(options),
    { component: options.editor, shrink: 1, minSize: COMPOSER_MIN_SIZE },
  ], options.pane?.onConversationPointer ?? (() => undefined))

  const railWidth = Math.max(RAIL_MIN_SIZE, Math.round(options.railWidth))
  const pane = options.pane
  let paneWidth = pane === undefined ? 0 : Math.max(SPLIT_MIN_SIZE, Math.round(pane.width))

  const rule = new BottomRule()
  const entries: NonNullable<ConstructorParameters<typeof HStack>[0]> = [
    { component: new RuledColumn(options.rail, rule), basis: railWidth, grow: 0, shrink: 0 },
    { component: new RuledColumn(options.railDivider, rule), basis: SPLIT_GAP, shrink: 0 },
    { component: conversation, basis: 0, grow: 1, shrink: 1, minSize: RAIL_CONVERSATION_MIN },
  ]
  const ruledPane = pane === undefined ? undefined : new RuledColumn(pane.component, rule)
  if (pane !== undefined) {
    entries.push(
      { component: new RuledColumn(pane.divider, rule), basis: SPLIT_GAP },
      { component: ruledPane!, basis: paneWidth, grow: 0, shrink: 1, minSize: SPLIT_MIN_SIZE },
    )
  }

  const columns = new HStack(entries)

  // One status row under the frame's bottom rule. It spans the whole width — it
  // is the frame's footer, not a column's — but its readings begin at the
  // conversation's left edge, and the model label keeps the right one.
  const root = new VStack([
    { component: columns, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    {
      component: new HStack([
        { component: new BlankColumn(), basis: railWidth + SPLIT_GAP, grow: 0, shrink: 0 },
        { component: options.statusBar, basis: 0, grow: 1, shrink: 1, minSize: 1 },
      ]),
      shrink: 0,
    },
  ])

  /** Move the editor divider; without a pane this layout has nothing to resize. */
  const setPaneWidth = (width: number): void => {
    if (pane === undefined) return
    const next = Math.max(SPLIT_MIN_SIZE, Math.round(width))
    if (next === paneWidth) return
    paneWidth = next
    columns.removeChild(ruledPane!)
    columns.addChild(ruledPane!, { basis: paneWidth, grow: 0, shrink: 1, minSize: SPLIT_MIN_SIZE })
  }

  return { root, transcriptScroll, setPaneWidth }
}

/**
 * The two side columns with no conversation between them.
 *
 * The status bar stays: it belongs to the client rather than to the transcript,
 * and the turn clock and update hint have to stay visible while the transcript
 * is put away. The rail becomes the flexible column because a hidden transcript
 * is not a reading column whose width needs protecting.
 * @param options - whichever side columns exist, and the status row.
 * @returns the layout root and the pane-width hook.
 */
export function buildSideColumnsLayout(options: SideColumnsLayoutOptions): SideColumnsLayout {
  const rail = options.rail
  const pane = options.pane
  let paneWidth = pane === undefined ? 0 : Math.max(SPLIT_MIN_SIZE, Math.round(pane.width))

  const columns = new HStack(rail === undefined
    ? [{ component: pane!.component, basis: 0, grow: 1, shrink: 1, minSize: 1 }]
    : pane === undefined
      ? [{ component: rail.component, basis: 0, grow: 1, shrink: 1, minSize: 1 }]
      : [
          { component: rail.component, basis: Math.max(RAIL_MIN_SIZE, Math.round(rail.width)), grow: 1, shrink: 1, minSize: RAIL_MIN_SIZE },
          { component: rail.divider, basis: SPLIT_GAP, shrink: 0 },
          { component: pane.component, basis: paneWidth, grow: 0, shrink: 1, minSize: SPLIT_MIN_SIZE },
        ])

  // Even with the conversation put away the frame keeps its bottom line: the
  // side columns end on it and the status row sits under it, as it does when the
  // conversation is on screen.
  const root = new VStack([
    { component: columns, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: new BottomRule(), shrink: 0 },
    { component: options.statusBar, shrink: 0 },
  ])

  /** Move the divider; a lone column has no second width to trade against. */
  const setPaneWidth = (width: number): void => {
    if (rail === undefined || pane === undefined) return
    const next = Math.max(SPLIT_MIN_SIZE, Math.round(width))
    if (next === paneWidth) return
    paneWidth = next
    columns.removeChild(pane.component)
    columns.addChild(pane.component, { basis: paneWidth, grow: 0, shrink: 1, minSize: SPLIT_MIN_SIZE })
  }

  return { root, setPaneWidth }
}

/**
 * Conversation on the left, editor on the right.
 *
 * There is no title bar: the transcript and the editor both run to the top edge
 * of the terminal, which is what the editor needs to look like an editor.
 *
 * The editor takes an explicit column count instead of an equal `grow` share:
 * `allocateStackSizes` distributes leftover width greedily (the first entry of
 * equal weights received ~55% of a 100-column terminal), so an explicit basis
 * is the only way to make the divider land where the caller asked for it.
 * @param options - the shared chat pieces, the editor pane and its width.
 * @returns the layout root and the transcript viewport.
 */
export function buildSplitTerminalLayout(options: SplitTerminalLayoutOptions): SplitTerminalLayout {
  const transcriptScroll = new ScrollView(options.transcript, { follow: 'end', primary: true })

  const conversation = new ConversationColumn([
    { component: transcriptScroll, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    ...chatEntries(options),
    { component: options.editor, shrink: 1, minSize: COMPOSER_MIN_SIZE },
  ], options.onConversationPointer)

  let paneWidth = Math.max(SPLIT_MIN_SIZE, Math.round(options.paneWidth))

  // The composer's bottom line continues across the editor column too, so the
  // frame reads the same with one side column as with two.
  const rule = new BottomRule()
  const ruledPane = new RuledColumn(options.pane, rule)
  const columns = new HStack([
    { component: conversation, basis: 0, grow: 1, shrink: 1, minSize: SPLIT_MIN_SIZE },
    { component: new RuledColumn(options.divider, rule), basis: SPLIT_GAP },
    { component: ruledPane, basis: paneWidth, grow: 0, shrink: 1, minSize: SPLIT_MIN_SIZE },
  ])

  const root = new VStack([
    { component: columns, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: options.statusBar, shrink: 0 },
  ])

  /**
   * Move the divider. Re-adding the entry keeps the existing `ScrollView` (and
   * its scroll position) instead of rebuilding the whole layout on every drag
   * step, which is what a resize from the mouse would otherwise cause.
   */
  const setPaneWidth = (width: number): void => {
    const next = Math.max(SPLIT_MIN_SIZE, Math.round(width))
    if (next === paneWidth) return
    paneWidth = next
    columns.removeChild(ruledPane)
    columns.addChild(ruledPane, { basis: paneWidth, grow: 0, shrink: 1, minSize: SPLIT_MIN_SIZE })
  }

  return { root, transcriptScroll, setPaneWidth }
}
