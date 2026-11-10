/**
 * PromptEditor: pi-tui `Editor` with a Claude-style input arrow and an
 * upward-popping completion menu.
 *
 * The base `Editor` renders its autocomplete below the bottom border; this
 * subclass owns a small completion menu instead and renders it ABOVE the top
 * border, with the selected entry highlighted in the accent color.
 *
 * The menu follows pi's search-list rules instead of inventing its own: a
 * five-row window that slides with the selection, a `(n/total)` counter while
 * the list does not fit, a command column that lines the descriptions up,
 * arrows that wrap at both ends, PageUp/PageDown that move by one window, and
 * a wheel that moves one entry per notch. Without the window a reader could
 * only see the first few matches and had no way to reach the rest.
 *
 * The base `Editor` also always draws a filled cursor, which stays visible as
 * pi-tui's reverse-video block. Without focus the cell is rewritten as the same
 * ghost block so the column still shows where its cursor is.
 *
 * The two rules are inset by the body's padding instead of spanning the column.
 * They belong to the composer, not to the frame: a rule that reached the column
 * edge would touch the divider the layout draws beside it, and this client keeps
 * every line clear of every other line.
 *
 * @module hulala-cli/tui/view/promptEditor
 */
import { readdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  Editor,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type EditorOptions,
  type EditorTheme,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from '@earendil-works/pi-tui'
import { slashCommands, listMove } from '../keys.js'
import { scrollLabel, windowOf } from './selector/chrome.js'
import { buildStyles } from './theme.js'

interface MenuEntry {
  value: string
  description?: string
  /** Argument placeholder, folded into the description column like pi's menu. */
  hint?: string
  /** The action's shortcut, right-aligned at the end of the row. */
  keys?: string
}

/**
 * Rows the completion menu shows before it starts scrolling.
 *
 * pi's `autocompleteMaxVisible` default: the menu is a hint above the composer,
 * not a browser, so five rows is enough to recognise the command and the
 * counter carries the position in the whole list.
 */
const MENU_ROWS = 5

/** Rows the menu leaves on screen for the transcript, the composer and the band. */
const MENU_RESERVED_ROWS = 8

/** Width of the command column, matching pi's slash-command list (12–32 cells). */
const MENU_NAME_MIN_WIDTH = 12
const MENU_NAME_MAX_WIDTH = 32

/** Below this width a row drops the description column and shows the command alone. */
const MENU_TWO_COLUMN_MIN_WIDTH = 40

/** Room a description needs before the column is worth drawing at all. */
const MENU_MIN_DESCRIPTION_WIDTH = 10

/** Widest shortcut column the menu draws; longer labels are clipped. */
const MENU_KEYS_MAX_WIDTH = 16

/** Fallback for the dim cursor when colour output is disabled. */
const HOLLOW_CURSOR = '□'

/**
 * pi-tui's fake-cursor APC markers (the pair `renderFakeCursor` wraps a cell
 * with). The base `Editor` always draws a filled cursor, and the renderer only
 * drops it for a focused component, so an unfocused composer is rewritten here.
 */
const FAKE_CURSOR = /\u001b_pi:fc\u0007(.*?)(?:\u001b_pi:\/fc\u0007|$)/s

export interface PromptEditorOptions extends EditorOptions {
  color: boolean
  /**
   * SGR for the faded cursor block shown without focus; `''` falls back
   * to a hollow glyph.
   */
  faintCursor?: () => string
  /**
   * Tell the terminal when the menu takes `PageUp`/`PageDown` for its window.
   *
   * The alt-screen viewport claims those keys before any component sees them,
   * so the two owners have to be arbitrated above the editor rather than by
   * focus: a menu can outlive a focus change.
   */
  onMenuOpen?: (open: boolean) => void
}

/**
 * Blank `inset` cells off each end of a styled one-line rule.
 *
 * The base editor colours a whole border line as one run, so trimming visible
 * cells only has to step around the leading SGR and the trailing reset; the
 * blanked cells stay inside that run and are just background.
 * @param line - one border line from the base editor.
 * @param inset - cells to blank at each end.
 * @returns the line, inset from both edges.
 */
function insetRule(line: string, inset: number): string {
  const open = /^(?:\u001b\[[0-9;]*m)+/u.exec(line)?.[0] ?? ''
  const close = /(?:\u001b\[[0-9;]*m)+$/u.exec(line.slice(open.length))?.[0] ?? ''
  const body = line.slice(open.length, line.length - close.length)
  if (body.length <= inset * 2) return line
  return `${open}${' '.repeat(inset)}${body.slice(inset, body.length - inset)}${' '.repeat(inset)}${close}`
}

export class PromptEditor extends Editor {
  private readonly color: boolean
  private readonly faintCursor: (() => string) | undefined
  private readonly onMenuOpen: ((open: boolean) => void) | undefined
  private readonly styles: ReturnType<typeof buildStyles>
  /**
   * Receive every submitted draft with the gesture that named its delivery
   * mode.
   *
   * `enter` is plain Enter (and the Send-equivalent path inside a completion
   * menu); `accelerated` is the queue chord, which the base editor would spend
   * on a newline — `\x1b\r` reaches it through the shift-enter workaround, so
   * the gesture has to be claimed here first, the same ordering pi's
   * `CustomEditor` uses for `app.message.followUp`. Both gestures submit
   * through the base editor, so trimming, paste expansion and the cleared
   * composer are identical.
   */
  onSubmitGesture: ((text: string, gesture: 'enter' | 'accelerated') => void) | undefined
  /** Which gesture the next base-editor submit belongs to. */
  private gesture: 'enter' | 'accelerated' = 'enter'
  private menu: MenuEntry[] | null = null
  private menuIndex = 0
  private menuStart = 0
  private menuToken = ''
  private requestId = 0
  /** Rows the menu drew last frame, counter row included, for hit-testing. */
  private renderedMenuHeight = 0
  /** First entry of the window the menu drew last frame. */
  private renderedMenuStart = 0
  /** Item rows the window drew last frame, without the counter row. */
  private renderedMenuRows = 0

  constructor(tui: TUI, theme: EditorTheme, options: PromptEditorOptions) {
    const { color, faintCursor, onMenuOpen, ...editorOptions } = options
    super(tui, theme, { paddingX: 2, ...editorOptions })
    this.color = color
    this.faintCursor = faintCursor
    this.onMenuOpen = onMenuOpen
    this.styles = buildStyles(color)
    this.onSubmit = text => { this.onSubmitGesture?.(text, this.gesture) }
  }

  /**
   * The completion menu is up, so the dock gives its rows to the menu instead
   * of the working-directory line.
   */
  get completionMenuOpen(): boolean {
    return this.menu !== null && this.menu.length > 0
  }

  /**
   * Recompute the completion menu for the draft as it stands.
   *
   * The menu is otherwise rebuilt only when the draft changes, so a completion
   * source that arrives late — the Host's command catalog after a Session
   * opens — would stay invisible until the next keystroke. A draft that no
   * longer names a completion closes the menu, which is the same thing typing
   * would have done.
   */
  refreshMenu(): void {
    this.refresh(true)
  }

  render(width: number): string[] {
    const menu = this.renderMenu(width)
    this.renderedMenuHeight = menu.length
    const base = super.render(width)
    // Without focus the filled cursor fades into a ghost (or a hollow glyph
    // when colour is off): the column still shows where its cursor is while the
    // keyboard is in the other one, without reading as the active caret.
    if (!this.focused) {
      const faint = this.faintCursor?.() ?? ''
      for (let index = 0; index < base.length; index += 1) {
        base[index] = (base[index] ?? '').replace(
          FAKE_CURSOR,
          (_whole, cell: string) => faint === '' ? HOLLOW_CURSOR : `\u001b[0m${faint}${cell}\u001b[0m`,
        )
      }
    }
    // Insert the Claude-style arrow into the first body line (two padding
    // columns are reserved by `paddingX: 2`, so the cursor column is stable).
    if (width >= 5 && base.length > 1) {
      const arrow = this.color ? '\u001b[36m❯\u001b[0m ' : '❯ '
      base[1] = arrow + (base[1] ?? '').slice(2)
    }
    // Both rules stop at the body's own gutter instead of the column edge. The
    // rules are the composer's, not the column's: a full-width rule would run
    // into the frame's dividers at both ends, and the transcript's own rows put
    // their content in this same column.
    const inset = Math.min(this.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)))
    if (inset > 0 && base.length > 2) {
      base[0] = insetRule(base[0] ?? '', inset)
      base[base.length - 1] = insetRule(base[base.length - 1] ?? '', inset)
    }
    return [...menu, ...base]
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    // The completion menu renders above the editor body: route pointer events
    // over it to the entry under the pointer, and shift the editor body down by
    // the menu height before delegating.
    if (this.menu !== null && this.renderedMenuHeight > 0 && event.y < this.renderedMenuHeight) {
      // A notch moves one entry, like pi's select list. The counter row belongs
      // to the menu too, so the wheel never falls through to the transcript.
      if (event.type === 'wheel') {
        this.moveMenu(event.wheelDelta !== undefined && event.wheelDelta < 0 ? -1 : 1, false)
        return { handled: true, focus: true, render: true }
      }
      // The window slides with the selection, so the row under the pointer is
      // only in the list after the start offset is added back. Hovering does not
      // select: with a window centred on the selection, a hover that moved the
      // window would drag a different entry under the pointer every event.
      const index = this.renderedMenuStart + event.y
      const left = event.button === 'left' && (event.type === 'press' || event.type === 'click')
      if (event.y < this.renderedMenuRows && index < this.menu.length && left) {
        const changed = index !== this.menuIndex
        if (changed) {
          this.menuIndex = index
          this.tui.requestRender()
        }
        // A click accepts, exactly like Tab on the highlighted row.
        if (event.type === 'click') this.acceptCompletion(this.menu[index])
        return { handled: true, focus: true, render: changed }
      }
      return { handled: true, focus: true }
    }
    return super.handleMouse({ ...event, y: event.y - this.renderedMenuHeight })
  }

  handleInput(data: string): void {
    // The queue chord outranks both the completion menu and the base editor's
    // newline handling: it names a delivery mode, not more text. The submit
    // itself is the base editor's, so the composer clears exactly as Enter does.
    if (matchesKey(data, 'alt+enter')) {
      this.dismissMenu()
      this.gesture = 'accelerated'
      try {
        super.handleInput('\r')
      } finally {
        this.gesture = 'enter'
      }
      return
    }
    if (this.menu !== null) {
      if (matchesKey(data, 'tab')) {
        this.acceptCompletion()
        return
      }
      if (matchesKey(data, 'enter')) {
        // Matching pi-tui: Enter on a slash-command completion accepts it and
        // falls through to submit (so `/quit` + Enter quits immediately).
        const selected = this.menu[this.menuIndex]?.value ?? this.menu[0]?.value
        const submitAfter = selected?.startsWith('/') === true
        this.acceptCompletion()
        if (submitAfter) super.handleInput('\r')
        return
      }
      if (listMove(data, 'up')) {
        this.moveMenu(-1, true)
        return
      }
      if (listMove(data, 'down')) {
        this.moveMenu(1, true)
        return
      }
      // One window at a time, clamped: the keyboard has no scrollbar, and the
      // counter says where in the list the selection landed.
      if (matchesKey(data, 'pageUp')) {
        this.moveMenu(-this.menuCapacity(), false)
        return
      }
      if (matchesKey(data, 'pageDown')) {
        this.moveMenu(this.menuCapacity(), false)
        return
      }
      if (matchesKey(data, 'escape')) {
        this.dismissMenu()
        this.tui.requestRender()
        return
      }
    }

    if (matchesKey(data, 'tab') && this.menu === null) {
      this.refresh(true)
      return
    }

    super.handleInput(data)
    this.refresh(false)
  }

  /**
   * Close the completion menu and drop results still in flight.
   *
   * A submitted draft must not leave a completion to reopen the menu with an
   * entry the composer no longer holds.
   */
  private dismissMenu(): void {
    this.menuToken = ''
    this.requestId += 1
    this.setMenu(null)
  }

  /**
   * Replace the menu, announcing when paging ownership changes.
   *
   * `PageUp`/`PageDown` are the viewport's by default; while the menu is up
   * they page its window instead, so the owner is announced rather than
   * inferred from focus.
   * @param entries - the new matches, or null to close the menu.
   * @param start - offset in the draft where the completed token began.
   */
  private setMenu(entries: MenuEntry[] | null, start?: number): void {
    const wasOpen = this.completionMenuOpen
    this.menu = entries === null || entries.length === 0 ? null : entries
    if (start !== undefined) this.menuStart = start
    if (this.menu !== null) this.menuIndex = 0
    const open = this.completionMenuOpen
    if (open !== wasOpen) this.onMenuOpen?.(open)
    if (open || wasOpen) this.tui.requestRender()
  }

  /**
   * Move the menu selection.
   *
   * The arrows wrap at both ends, as pi's select list does, so the last command
   * stays reachable without counting rows. Paging and the wheel clamp instead,
   * so the end of the list is not a jump back to the other end.
   * @param delta - rows to move, negative for up.
   * @param wrap - whether the ends continue at the other end.
   */
  private moveMenu(delta: number, wrap: boolean): void {
    const menu = this.menu
    if (menu === null || menu.length === 0) return
    const next = wrap
      ? (this.menuIndex + delta + menu.length) % menu.length
      : Math.max(0, Math.min(menu.length - 1, this.menuIndex + delta))
    if (next === this.menuIndex) return
    this.menuIndex = next
    this.tui.requestRender()
  }

  /**
   * Rows the menu may use on this terminal.
   *
   * Five is pi's `autocompleteMaxVisible` default. The cap by terminal height
   * keeps a short window from squeezing the composer and the transcript out of
   * the dock, and two rows is the smallest window that still shows movement.
   */
  private menuCapacity(): number {
    return Math.max(2, Math.min(MENU_ROWS, this.tui.terminal.rows - MENU_RESERVED_ROWS))
  }

  /**
   * Width of the command column.
   *
   * Sized to the widest command in the whole match set, not only the visible
   * window, so descriptions stay aligned while the window slides; clamped like
   * pi's slash-command layout and narrowed to leave the description its room.
   * @param width - composer width.
   * @returns the column width, gap included.
   */
  private menuNameWidth(width: number): number {
    const widest = (this.menu ?? []).reduce((max, entry) => Math.max(max, visibleWidth(entry.value)), 0) + 2
    const room = width - 2 - MENU_MIN_DESCRIPTION_WIDTH - 2
    return Math.max(MENU_NAME_MIN_WIDTH, Math.min(MENU_NAME_MAX_WIDTH, widest, room))
  }

  private renderMenu(width: number): string[] {
    const menu = this.menu
    if (menu === null || menu.length === 0) {
      this.renderedMenuStart = 0
      this.renderedMenuRows = 0
      return []
    }
    const capacity = this.menuCapacity()
    const window = windowOf(menu, this.menuIndex, capacity)
    this.renderedMenuStart = window.start
    this.renderedMenuRows = window.items.length
    const nameWidth = this.menuNameWidth(width)
    const lines = window.items.map((entry, offset) => this.renderMenuEntry(
      entry,
      window.start + offset === this.menuIndex,
      width,
      nameWidth,
    ))
    // pi shows the counter only while the window hides part of the list; a list
    // that fits needs no position report.
    const counter = scrollLabel(this.menuIndex, menu.length, window.start, capacity)
    if (counter !== undefined) lines.push(padToWidth(this.styles.dim(counter), width))
    return lines
  }

  /**
   * One menu row: the command, then the hint-and-description column.
   *
   * The selected row's label takes the accent colour and nothing else changes:
   * this client marks the current entry with text colour, never a filled row.
   * A composer too narrow for two columns shows the command alone, as pi does.
   */
  private renderMenuEntry(entry: MenuEntry, selected: boolean, width: number, nameWidth: number): string {
    const prefix = selected ? this.styles.accent('❯ ') : '  '
    const name = truncateToWidth(entry.value, Math.max(1, Math.min(nameWidth - 2, width - 2)), '…')
    const label = selected ? this.styles.accent(name) : name
    const keys = entry.keys === undefined ? '' : truncateToWidth(entry.keys, MENU_KEYS_MAX_WIDTH, '')
    const gap = Math.max(1, nameWidth - visibleWidth(name))
    const description = descriptionOf(entry)
    // The shortcut column is reserved before the description: it is what a reader
    // came for, and the description is the part that can be cut.
    const room = width - 2 - visibleWidth(name) - gap - 2 - (keys === '' ? 0 : visibleWidth(keys) + 2)
    const tail = keys === '' ? '' : `${this.styles.dim(keys)}`
    if (description !== undefined && width > MENU_TWO_COLUMN_MIN_WIDTH && room > MENU_MIN_DESCRIPTION_WIDTH) {
      const detail = truncateToWidth(description, room, '…')
      const used = 2 + visibleWidth(name) + gap + visibleWidth(detail) + (tail === '' ? 0 : visibleWidth(keys) + 1)
      const pad = Math.max(1, width - used)
      return padToWidth(`${prefix}${label}${this.styles.dim(`${' '.repeat(gap)}${detail}`)}${' '.repeat(pad)}${tail}`, width)
    }
    if (tail !== '') {
      const used = 2 + visibleWidth(name) + visibleWidth(keys)
      const pad = Math.max(1, width - used)
      return padToWidth(`${prefix}${label}${' '.repeat(pad)}${tail}`, width)
    }
    const full = truncateToWidth(entry.value, Math.max(1, width - 2), '…')
    return padToWidth(`${prefix}${selected ? this.styles.accent(full) : full}`, width)
  }

  private tokenUnderCursor(): { token: string; start: number } {
    const text = this.getText()
    const { line, col } = this.getCursor()
    if (line !== 0) return { token: '', start: -1 }
    const before = text.slice(0, col)
    const match = /(\S*)$/u.exec(before)
    const token = match?.[1] ?? ''
    return { token, start: col - token.length }
  }

  private providerKind(token: string, start: number): 'slash' | 'path' | null {
    if (start === 0 && token.startsWith('/')) return 'slash'
    if (isPathLike(token)) return 'path'
    return null
  }

  private refresh(force = false): void {
    const { token, start } = this.tokenUnderCursor()
    const kind = this.providerKind(token, start)
    if (kind === null) {
      this.menuToken = ''
      // Drop completions still in flight: a stale result would reopen the menu
      // after submit and make Enter accept the entry the composer no longer holds.
      this.requestId += 1
      this.setMenu(null)
      return
    }
    if (!force && token === this.menuToken && this.menu !== null) return
    this.menuToken = token
    const requestId = ++this.requestId
    const result = kind === 'slash' ? Promise.resolve(this.completeSlash(token)) : this.completePath(token)
    void result.then(entries => {
      if (requestId !== this.requestId) return
      this.setMenu(entries, start)
    })
  }

  private acceptCompletion(entry: MenuEntry | undefined = this.menu?.[this.menuIndex] ?? this.menu?.[0]): void {
    if (entry === undefined) return
    const text = this.getText()
    const cursor = this.getCursor().col
    const before = text.slice(0, this.menuStart)
    const after = text.slice(cursor)
    const trailing = entry.value.startsWith('/') && this.menuStart === 0 ? ' ' : ''
    this.setText(before + entry.value + trailing + after)
    this.dismissMenu()
    this.tui.requestRender()
  }

  private completeSlash(prefix: string): MenuEntry[] {
    const needle = prefix.toLowerCase()
    return slashCommands()
      .filter(command => `/${command.name}`.toLowerCase().startsWith(needle))
      .map(command => ({
        value: `/${command.name}`,
        ...(command.argumentHint === undefined ? {} : { hint: command.argumentHint }),
        ...(command.description === undefined ? {} : { description: command.description }),
        ...(command.keys === undefined ? {} : { keys: command.keys }),
      }))
  }

  private async completePath(prefix: string): Promise<MenuEntry[]> {
    const home = process.env.HOME ?? '~'
    const expanded = prefix.startsWith('~') ? prefix.replace(/^~/, home) : prefix
    const absolute = isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded)
    const directory = dirname(absolute)
    const baseName = absolute.slice(directory.length + 1)
    const dirPrefix = prefix.slice(0, Math.max(0, prefix.length - baseName.length))
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      return []
    }
    return entries
      .filter(name => !name.startsWith('.'))
      .map(name => ({ value: `${dirPrefix}${name}` }))
      .sort()
  }
}

function isPathLike(token: string): boolean {
  return token.startsWith('/') || token.startsWith('./') || token.startsWith('../') || token.startsWith('~')
}

/** Pad a rendered row to the composer width so a shorter line erases the old one. */
function padToWidth(line: string, width: number): string {
  const missing = width - visibleWidth(line)
  return missing > 0 ? line + ' '.repeat(missing) : line
}

/** One line, so a wrapped description cannot add rows to the menu. */
function singleLine(text: string): string {
  return text.replace(/[\r\n]+/gu, ' ').trim()
}

/**
 * A row's description column: the argument hint, then the description.
 *
 * pi's slash-command provider folds the hint into this column
 * (`[level] — set the thinking level`), which keeps the command name narrow and
 * scannable instead of pushing the description off the row.
 */
function descriptionOf(entry: MenuEntry): string | undefined {
  const description = entry.description === undefined ? undefined : singleLine(entry.description)
  if (entry.hint === undefined) return description
  return description === undefined ? entry.hint : `${entry.hint} — ${description}`
}
