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
 * There is no frame rule row. The composer's two rules stop short of its column
 * edges (`PromptEditor`), so they never touch a divider, and the columns all end
 * on the row above the status band — a full-width row with its own background,
 * which separates itself from the frame without drawing a line. A rule row under
 * the columns would put a horizontal line against every divider again, which is
 * the one thing this frame avoids.
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
 * The status band with a row of air above its text.
 *
 * The band is a filled surface, and text sitting directly under the composer's
 * bottom rule reads as if it were pressed against it. One band-coloured blank
 * row gives the text the same gutter the band already has at its sides, without
 * drawing a line the column dividers would meet.
 */
class StatusBand implements Component {
  constructor(private readonly bar: Component) {}
  invalidate(): void {
    this.bar.invalidate()
  }
  render(width: number): string[] {
    const [line = ''] = this.bar.render(width)
    // The band's fill and ink are the first line's own SGR run; nothing here
    // needs to know which colours they are.
    const open = /^(?:\u001b\[[0-9;]*m)+/u.exec(line)?.[0] ?? ''
    const blank = `${open}${' '.repeat(Math.max(0, width))}${open === '' ? '' : '\u001b[0m'}`
    return [blank, line]
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
    { component: new StatusBand(options.statusBar), shrink: 1, minSize: 0 },
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
 * transcript it is used to switch. The status band is the frame's own bottom
 * row: the rail and the pane end above it and the band carries the whole footer,
 * from the working directory at the far left to the model at the right edge.
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

  const entries: NonNullable<ConstructorParameters<typeof HStack>[0]> = [
    { component: options.rail, basis: railWidth, grow: 0, shrink: 0 },
    { component: options.railDivider, basis: SPLIT_GAP, shrink: 0 },
    { component: conversation, basis: 0, grow: 1, shrink: 1, minSize: RAIL_CONVERSATION_MIN },
  ]
  if (pane !== undefined) {
    entries.push(
      { component: pane.divider, basis: SPLIT_GAP },
      { component: pane.component, basis: paneWidth, grow: 0, shrink: 1, minSize: SPLIT_MIN_SIZE },
    )
  }

  const columns = new HStack(entries)

  // The status band is the frame's bottom row: the working directory sits at the
  // far left, the readings follow it and the model label keeps the right edge.
  // The columns end above it, so no divider is drawn against it.
  const root = new VStack([
    { component: columns, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: new StatusBand(options.statusBar), shrink: 0 },
  ])

  /** Move the editor divider; without a pane this layout has nothing to resize. */
  const setPaneWidth = (width: number): void => {
    if (pane === undefined) return
    const next = Math.max(SPLIT_MIN_SIZE, Math.round(width))
    if (next === paneWidth) return
    paneWidth = next
    columns.removeChild(pane.component)
    columns.addChild(pane.component, { basis: paneWidth, grow: 0, shrink: 1, minSize: SPLIT_MIN_SIZE })
  }

  return { root, transcriptScroll, setPaneWidth }
}

/**
 * The two side columns with no conversation between them.
 *
 * The status bar stays: it belongs to the client rather than to the transcript,
 * and the turn clock and update hint have to stay visible while the transcript
 * is put away. It is the frame's bottom band, so the columns end above it. The
 * rail becomes the flexible column because a hidden transcript is not a reading
 * column whose width needs protecting.
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

  // Even with the conversation put away the frame keeps its status band: the
  // side columns end above it, as they do when the conversation is on screen.
  const root = new VStack([
    { component: columns, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: new StatusBand(options.statusBar), shrink: 0 },
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

  const columns = new HStack([
    { component: conversation, basis: 0, grow: 1, shrink: 1, minSize: SPLIT_MIN_SIZE },
    { component: options.divider, basis: SPLIT_GAP },
    { component: options.pane, basis: paneWidth, grow: 0, shrink: 1, minSize: SPLIT_MIN_SIZE },
  ])

  const root = new VStack([
    { component: columns, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: new StatusBand(options.statusBar), shrink: 0 },
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
    columns.removeChild(options.pane)
    columns.addChild(options.pane, { basis: paneWidth, grow: 0, shrink: 1, minSize: SPLIT_MIN_SIZE })
  }

  return { root, transcriptScroll, setPaneWidth }
}
