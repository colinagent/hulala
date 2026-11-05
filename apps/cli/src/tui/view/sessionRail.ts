/**
 * Left session rail: working directory, a filter box, this directory's
 * Sessions, and the global section folded at the bottom.
 *
 * The rows mirror the Web sidebar's session rows rather than inventing a new
 * vocabulary: a running Session carries a braille spinner, the label is the
 * Host's `title` projection, and the trailing label is the same relative-time
 * bucketing the Web client uses (`now`, `5m`, `3h`, `2d`, `4mo`, `1y`).
 * Selection is foreground colour only — the rail never paints a filled row.
 *
 * The rail owns only its cursor and window; the Session list, the filter text
 * and the `all` fold live in the app so the repaint timer can see them.
 *
 * @module hulala-cli/tui/view/sessionRail
 */
import {
  CURSOR_MARKER,
  fuzzyFilter,
  matchesKey,
  renderFakeCursor,
  truncateToWidth,
  visibleWidth,
  type Component,
} from '@earendil-works/pi-tui'
import type { TerminalSession } from '../data/remote.js'
import { listMove } from '../keys.js'
import { fitPath, padEnd } from './pathText.js'
import { buildStyles } from './theme.js'

/**
 * Hard limit on the current directory's first page.
 *
 * The page is also capped by the rows the rail can show at once (`pageRows`), so
 * `More` always sits one line past what is on screen instead of 20 rows below a
 * short window. The Web sidebar pages each workspace the same way: the Host list
 * is already complete in the client, and the view holds it to a first page with
 * an explicit reveal, so a long history never turns into an endless sidebar.
 */
export const RAIL_SESSION_LIMIT = 30

/**
 * How far running/current rows may widen the first page.
 *
 * The Web raises a workspace's watermark automatically so that a turn running
 * behind the fold stays visible, and caps that automatic raise at 50; the same
 * rule keeps a background turn reachable here without defeating the page limit.
 */
export const RAIL_SESSION_LIMIT_MAX = 50

/** Frames of the running indicator, in the order the Web loader turns. */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

/** One frame of the running indicator for a given clock. */
export function spinnerFrame(now: number): string {
  return SPINNER_FRAMES[Math.floor(Math.max(0, now) / 100) % SPINNER_FRAMES.length]!
}

/**
 * Compact relative time, bucketed exactly like the Web client's `relativeTime`
 * so the terminal row and the sidebar row date a Session the same way.
 * @param updatedAt - epoch ms of the Session's last activity.
 * @param now - current epoch ms.
 * @returns `now`, `5m`, `3h`, `2d`, `4mo` or `1y`.
 */
export function relativeTimeLabel(updatedAt: number, now: number): string {
  const MINUTE = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const diff = Math.max(0, now - updatedAt)
  if (diff < MINUTE) return 'now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d`
  if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))}mo`
  return `${Math.floor(diff / (365 * DAY))}y`
}

/**
 * Clip one plain label to a column budget.
 *
 * `truncateToWidth` wraps its ellipsis in resets to keep styles from bleeding;
 * these labels are plain text, and those resets would end the accent colour the
 * row applies around them, so they are dropped here.
 * @param text - plain label text.
 * @param width - columns to fill at most.
 * @returns the label, ellipsized to fit.
 */
function clip(text: string, width: number): string {
  return truncateToWidth(text, width, '…').replace(/\u001b\[0m/gu, '')
}

/**
 * A selected row: the cursor cell, then the rest in the selection ink.
 *
 * Every column shows where the keyboard is with the same cursor — the composer
 * at its caret, a program column at the cell the program drew, the rail at the
 * head of its row. That cursor is an inverted cell, so the colours it inverts
 * decide what the block looks like: keeping the cell outside the accent run
 * makes it the same neutral block as the composer's instead of a teal one.
 * @param text - the row's plain text.
 * @param styles - the rail's styles.
 * @param caret - whether this row carries the cursor.
 * @returns the row, styled.
 */
function selectedRow(text: string, styles: ReturnType<typeof buildStyles>, caret: boolean): string {
  if (!caret || text === '') return styles.accent(text)
  const first = String.fromCodePoint(text.codePointAt(0) ?? 32)
  return `${CURSOR_MARKER}${renderFakeCursor(first)}${styles.accent(text.slice(first.length))}`
}

/** Same directory, ignoring a trailing separator. */
export function sameDirectory(left: string | undefined, right: string): boolean {
  if (left === undefined) return false
  const strip = (value: string): string => value.replace(/\/+$/u, '')
  return strip(left) === strip(right)
}

/**
 * The label a row shows: the Host title, `new session` for a Session with no
 * history yet, else a short id.
 *
 * A title wins over the blank placeholder. The `blank` flag is the Host's view
 * at the moment the list was read, and this client's own `+ new session` row
 * starts out blank; testing blank first would keep a Session that has been
 * talking behind `new session` until the whole list was read again.
 * @param session - the Session row to label.
 * @returns the row's plain text label.
 */
export function sessionLabel(session: TerminalSession): string {
  const title = session.title?.trim() ?? ''
  if (title !== '') return title
  if (session.blank) return 'new session'
  return `${session.sessionId.slice(0, 4)}…${session.sessionId.slice(-4)}`
}

/** Everything the rail renders from. */
export interface RailState {
  readonly sessions: readonly TerminalSession[]
  /** Directory whose Sessions head the list (the open Session's cwd). */
  readonly cwd: string
  readonly currentId?: string | undefined
  /** Filter text; empty shows every Session in scope. */
  readonly query: string
  /** The bottom `all` section is unfolded. */
  readonly allExpanded: boolean
  /** The current directory's `More` row was taken: every row is shown. */
  readonly revealed: boolean
  /** Session rows the rail can show at once, below the `+ new session` row. */
  readonly pageRows: number
  readonly now: number
}

/** The two sections: this directory, and the rest of the Host. */
export interface RailLists {
  /** Current directory, first page only (or everything once revealed). */
  readonly current: readonly TerminalSession[]
  readonly foreign: readonly TerminalSession[]
  /** Current-directory rows the `More` row hides. */
  readonly hidden: number
  /** Current-directory rows in scope before the page limit. */
  readonly total: number
}

/**
 * The first page of one section.
 *
 * Base limit plus the Web's automatic raise: a running Session, or the open one,
 * that sits past the limit pulls it out far enough to include itself, up to
 * `RAIL_SESSION_LIMIT_MAX`. Revealing the section lifts the limit entirely.
 * @param ordered - the section after blank filtering, filtering and ordering.
 * @param state - the rail state driving the fold.
 * @returns the rows to paint before the `More` row.
 */
function firstPage(
  ordered: readonly TerminalSession[],
  state: Pick<RailState, 'revealed' | 'currentId' | 'pageRows'>,
): readonly TerminalSession[] {
  if (state.revealed) return ordered
  // The window's own capacity first: `More` then follows the page by one line.
  let limit = Math.min(RAIL_SESSION_LIMIT, Math.max(1, state.pageRows))
  const lastAttention = ordered.reduce(
    (last, session, index) => session.running || session.sessionId === state.currentId ? index : last,
    -1,
  )
  if (lastAttention >= limit) limit = Math.min(RAIL_SESSION_LIMIT_MAX, lastAttention + 1)
  return ordered.slice(0, limit)
}

/**
 * Split the Host's Sessions into the rail's two sections.
 *
 * Blank Sessions are hidden unless they are the open one (the Web pins its one
 * blank row the same way), subagents never reach this list, and the filter only
 * searches the section that is on screen — with `all` folded, a query stays
 * inside the current directory.
 * @param state - the rail's current data.
 * @returns both sections in display order.
 */
export function railLists(state: RailState): RailLists {
  const visible = state.sessions.filter(session => !session.blank || session.sessionId === state.currentId)
  const query = state.query.trim()
  const text = (session: TerminalSession): string => `${sessionLabel(session)} ${session.sessionId} ${session.cwd ?? ''}`
  const pick = (candidates: readonly TerminalSession[]): TerminalSession[] => {
    const list = [...candidates]
    if (query === '') return list.sort((left, right) => right.updatedAt - left.updatedAt)
    return fuzzyFilter(list, query, text)
  }
  const ordered = pick(visible.filter(session => sameDirectory(session.cwd, state.cwd)))
  // A filter is already an explicit request: show every match instead of a page.
  const current = query === '' ? firstPage(ordered, state) : ordered
  const foreign = state.allExpanded
    ? pick(visible.filter(session => !sameDirectory(session.cwd, state.cwd)))
    : []
  return { current, foreign, hidden: ordered.length - current.length, total: ordered.length }
}

/** One keyboard-reachable row; the `all` fold is addressed after these. */
export type RailRow =
  | { readonly kind: 'new' }
  | { readonly kind: 'session'; readonly session: TerminalSession }
  | { readonly kind: 'more'; readonly hidden: number; readonly revealed: boolean }

export interface SessionRailOptions {
  readonly state: () => RailState
  /** Rows the column was given; the rail paints exactly this many lines. */
  readonly rows: () => number
  readonly color: boolean
  /** The client's own rail-focus flag: the cursor row is accented only then. */
  readonly focused?: () => boolean
  readonly onOpen: (sessionId: string) => void
  readonly onNew: () => void
  readonly onQuery: (query: string) => void
  readonly onAllExpanded: (expanded: boolean) => void
  /** The `More` row was taken (`true`) or the expanded section folded back. */
  readonly onRevealed: (revealed: boolean) => void
  readonly onRefresh: () => void
}

export class SessionRail implements Component {
  /** Set by pi-tui when the rail owns the keyboard; only then is a row accented. */
  focused = false
  private readonly options: SessionRailOptions
  private cursor = 0
  private offset = 0
  private searching = false

  constructor(options: SessionRailOptions) {
    this.options = options
  }

  invalidate(): void {}

  /** True while Esc belongs to the filter box rather than to leaving the rail. */
  get filterFocused(): boolean {
    return this.searching
  }

  /**
   * Prepare the rail for keyboard entry: drop the filter and put the cursor on
   * the Session the conversation is showing.
   * @param sessionId - the open Session, if one is open.
   */
  startEditing(sessionId: string | undefined): void {
    this.searching = false
    this.selectCurrent(sessionId)
  }

  /** Move the cursor onto one Session without touching the filter. */
  selectCurrent(sessionId: string | undefined): void {
    if (sessionId === undefined) return
    const index = this.rowsOf().findIndex(row => row.kind === 'session' && row.session.sessionId === sessionId)
    if (index >= 0) this.cursor = index
  }

  handleInput(data: string): void {
    const state = this.options.state()
    const rows = this.rowsOf()
    if (this.searching) {
      if (matchesKey(data, 'escape')) {
        this.setQuery('')
        this.searching = false
        return
      }
      if (matchesKey(data, 'enter')) {
        this.activate(rows)
        return
      }
      if (listMove(data, 'up')) {
        this.move(-1, rows.length)
        return
      }
      if (listMove(data, 'down')) {
        this.move(1, rows.length)
        return
      }
      if (matchesKey(data, 'backspace')) {
        this.setQuery(state.query.slice(0, -1))
        return
      }
      if (data.length === 1 && data.charCodeAt(0) >= 0x20) {
        this.setQuery(state.query + data)
      }
      return
    }
    if (listMove(data, 'up') || data === 'k') {
      this.move(-1, rows.length)
      return
    }
    if (listMove(data, 'down') || data === 'j') {
      this.move(1, rows.length)
      return
    }
    if (matchesKey(data, 'enter')) {
      this.activate(rows)
      return
    }
    if (matchesKey(data, 'left')) {
      if (state.allExpanded) this.fold(false, false)
      return
    }
    if (matchesKey(data, 'right')) {
      if (!state.allExpanded) this.fold(true, false)
      return
    }
    if (data === '/') {
      this.searching = true
      return
    }
    if (data === 'n') {
      this.options.onNew()
      return
    }
    if (data === 'r') {
      this.options.onRefresh()
    }
  }

  render(width: number): string[] {
    const styles = buildStyles(this.options.color)
    const state = this.options.state()
    const rows = this.rowsOf(state)
    const height = Math.max(4, this.options.rows())
    const listArea = Math.max(1, height - 3)
    this.clampWindow(rows.length, listArea)

    const lines: string[] = []
    lines.push(padEnd(styles.dim(fitPath(state.cwd, width)), width))
    const focused = this.options.focused?.() ?? this.focused
    lines.push(this.filterLine(state, styles, width, focused))
    // The list owns the cursor only while the filter box does not; the filter's
    // own caret is emitted by `filterLine`.
    const showCaret = focused && !this.searching
    for (let index = 0; index < listArea; index += 1) {
      const row = rows[this.offset + index]
      lines.push(row === undefined
        ? ' '.repeat(Math.max(0, width))
        : this.rowLine(row, styles, width, state, focused && this.offset + index === this.cursor, showCaret))
    }
    lines.push(this.allLine(state, styles, width, focused && this.cursor === rows.length, showCaret))
    return lines.slice(0, height)
  }

  /**
   * The cursor-order rows: create, this directory's page, then the unfolded
   * `all` section. The page action and the `all` row follow these in the cursor.
   */
  private rowsOf(state = this.options.state()): RailRow[] {
    const { current, foreign, hidden, total } = railLists(state)
    // The page action sits where a 31st row would be — under the page, inside
    // the scroll, never beside the global `all` row at the bottom of the rail.
    const page: RailRow[] = state.revealed
      ? total > RAIL_SESSION_LIMIT ? [{ kind: 'more', hidden: 0, revealed: true }] : []
      : hidden > 0 ? [{ kind: 'more', hidden, revealed: false }] : []
    return [
      { kind: 'new' },
      ...current.map(session => ({ kind: 'session', session }) as const),
      ...page,
      ...foreign.map(session => ({ kind: 'session', session }) as const),
    ]
  }

  private setQuery(query: string): void {
    this.options.onQuery(query)
    // The `new` row heads the list, so a filtered cursor starts on the first
    // Session instead of on an action that would ignore the query.
    this.cursor = this.rowsOf().length > 1 ? 1 : 0
    this.offset = 0
  }

  private move(delta: number, last: number): void {
    this.cursor = Math.max(0, Math.min(last, this.cursor + delta))
  }

  private activate(rows: readonly RailRow[]): void {
    const row = rows[this.cursor]
    if (row === undefined) {
      this.fold(!this.options.state().allExpanded)
      return
    }
    if (row.kind === 'new') {
      if (!this.searching) this.options.onNew()
      return
    }
    if (row.kind === 'more') {
      this.reveal(!row.revealed)
      return
    }
    this.options.onOpen(row.session.sessionId)
  }

  /**
   * Take or fold back the current directory's `More` row.
   * @param revealed - true shows every row of the section.
   */
  private reveal(revealed: boolean): void {
    this.options.onRevealed(revealed)
    const index = this.rowsOf().findIndex(row => row.kind === 'more')
    if (index >= 0) this.cursor = index
  }

  /**
   * Fold or unfold the global section.
   * @param expanded - the state to set.
   * @param moveCursor - put the cursor on the `all` row (Enter on it keeps it
   *   there); the arrow keys fold without moving the selection.
   */
  private fold(expanded: boolean, moveCursor = true): void {
    this.options.onAllExpanded(expanded)
    if (moveCursor) this.cursor = this.rowsOf().length
  }

  private clampWindow(rowsLength: number, listArea: number): void {
    this.cursor = Math.max(0, Math.min(rowsLength, this.cursor))
    if (rowsLength <= listArea) {
      this.offset = 0
      return
    }
    const scrollIndex = Math.min(this.cursor, rowsLength - 1)
    if (scrollIndex < this.offset) this.offset = scrollIndex
    if (scrollIndex >= this.offset + listArea) this.offset = scrollIndex - listArea + 1
    this.offset = Math.max(0, Math.min(this.offset, rowsLength - listArea))
  }

  private filterLine(
    state: RailState,
    styles: ReturnType<typeof buildStyles>,
    width: number,
    focused: boolean,
  ): string {
    const prompt = `${styles.dim('>')} `
    // The caret the hardware cursor draws replaces the `▏` glyph: two carets in
    // one box would fight over the same cell.
    const caret = focused && this.searching
    const plain = `${state.query === '' ? 'search' : state.query}${this.searching && !caret ? '▏' : ''}`
    const clipped = clip(plain, Math.max(1, width - 2))
    const text = state.query === '' && !this.searching ? styles.dim(clipped) : clipped
    const cursor = caret ? `${CURSOR_MARKER}${renderFakeCursor(' ')}` : ''
    return padEnd(`${prompt}${text}${cursor}`, width)
  }

  private rowLine(
    row: RailRow,
    styles: ReturnType<typeof buildStyles>,
    width: number,
    state: RailState,
    selected: boolean,
    caret: boolean,
  ): string {
    if (row.kind === 'new') {
      const label = '+ new session'
      return selected ? selectedRow(padEnd(label, width), styles, caret) : padEnd(label, width)
    }
    if (row.kind === 'more') {
      const label = row.revealed ? '↑ Less' : `↓ More · ${row.hidden}`
      return selected ? selectedRow(padEnd(label, width), styles, caret) : padEnd(styles.dim(label), width)
    }
    const session = row.session
    const current = session.sessionId === state.currentId
    // The first column is the running indicator only. The open Session is marked
    // by its title colour, never by a glyph: a persistent marker would compete
    // with the row under the keyboard and with the tree chevrons.
    const glyph = session.running ? spinnerFrame(state.now) : ' '
    const time = relativeTimeLabel(session.updatedAt, state.now)
    const timeWidth = visibleWidth(time)
    const titleWidth = Math.max(1, width - 2 - timeWidth - 1)
    const title = clip(sessionLabel(session), titleWidth)
    const gap = Math.max(0, width - 2 - visibleWidth(title) - timeWidth - 1)
    const plain = `${glyph} ${title}${' '.repeat(gap)} ${time}`
    if (selected) return selectedRow(plain, styles, caret)
    const head = session.running ? styles.accent(glyph) : glyph
    const label = current ? styles.highlight(title) : title
    return `${head} ${label}${' '.repeat(gap)} ${styles.dim(time)}`
  }

  private allLine(
    state: RailState,
    styles: ReturnType<typeof buildStyles>,
    width: number,
    selected: boolean,
    caret: boolean,
  ): string {
    const label = `${state.allExpanded ? '▾' : '▸'} all`
    if (selected) return selectedRow(padEnd(label, width), styles, caret)
    return padEnd(styles.dim(label), width)
  }
}
