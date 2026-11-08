/**
 * The command palette: every command, what it does, and its shortcut.
 *
 * This is the surface a reader opens when the shortcut has been forgotten (or
 * cannot be delivered at all — a Command chord needs the Kitty keyboard protocol).
 * Because it is a modal and not part of the composer, it opens from the rail, from
 * Neovim and from the terminal column, and from a frame whose conversation column
 * is put away. Enter runs the highlighted command; a command that cannot run
 * without its argument is handed back to the composer pre-filled instead.
 *
 * The rows are the same catalog rows `/help` and the `/` menu print — name,
 * description, shortcut — only in the middle of the screen rather than above the
 * composer.
 *
 * @module hulala-cli/tui/view/overlays/commandPalette
 */
import type { Component } from '@earendil-works/pi-tui'
import { matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { commandCatalog, groupLabel, type CatalogEntry, type CommandGroup } from '../../commandCatalog.js'
import { t } from '../../i18n/index.js'
import { listMove } from '../../keys.js'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'

/** Rows the palette shows before it scrolls. */
const MAX_ROWS = 14

/** Wider hint columns are clipped; the palette is a list, not a key table. */
const MAX_HINT_WIDTH = 16

/** The groups in the order the palette lists them. */
const GROUP_ORDER: readonly CommandGroup[] = ['session', 'model', 'frame', 'app']

export interface CommandPaletteOptions {
  color: boolean
  /** Terminal rows, used to keep the list inside the panel. */
  rows?(): number
  /** The chosen command, or `undefined` when the reader closed the palette. */
  onResolve(entry: CatalogEntry | undefined): void
}

/** One rendered body line: a heading, or an item with its place in the list. */
type Row =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'item'; readonly entry: CatalogEntry; readonly index: number }

export class CommandPaletteOverlay implements Component {
  private readonly options: CommandPaletteOptions
  private query = ''
  private cursor = 0

  constructor(options: CommandPaletteOptions) {
    this.options = options
  }

  invalidate(): void {}

  /**
   * The entries the query leaves, in the order the panel paints them.
   *
   * Groups decide the order, not the catalog: the cursor indexes this list, so if
   * the rows were grouped and the cursor were not, Enter would run a different
   * command than the one under the highlight.
   */
  private visible(): CatalogEntry[] {
    const needle = this.query.trim().toLowerCase()
    const entries = commandCatalog().filter(entry =>
      needle === '' || entry.name.toLowerCase().includes(needle) || entry.description.toLowerCase().includes(needle))
    return GROUP_ORDER.flatMap(group => entries.filter(entry => entry.group === group))
  }

  /** Body lines: group headings only while nothing is typed. */
  private rows(entries: readonly CatalogEntry[]): Row[] {
    if (this.query.trim() !== '') {
      return entries.map((entry, index) => ({ kind: 'item', entry, index }))
    }
    const rows: Row[] = []
    let index = 0
    for (const group of GROUP_ORDER) {
      const members = entries.slice(index).filter(entry => entry.group === group)
      if (members.length === 0) continue
      rows.push({ kind: 'heading', text: groupLabel(group) })
      for (const entry of members) rows.push({ kind: 'item', entry, index: index++ })
    }
    return rows
  }

  /** How many body rows the panel can hold on this terminal. */
  private capacity(): number {
    return Math.max(4, Math.min(MAX_ROWS, (this.options.rows?.() ?? 24) - 9))
  }

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const inner = width - 4
    const entries = this.visible()
    const rows = this.rows(entries)
    const items = rows.flatMap(row => row.kind === 'item' ? [row.entry] : [])
    if (this.cursor >= items.length) this.cursor = Math.max(0, items.length - 1)
    const hintWidth = Math.min(
      MAX_HINT_WIDTH,
      items.reduce((max, entry) => Math.max(max, visibleWidth(entry.hint)), 0),
    )

    const body: string[] = []
    body.push(`${s.accent('> ')}${truncateToWidth(this.query, Math.max(4, inner - 2))}`)
    if (this.query.trim() === '') body.push(s.dim(truncateToWidth(t('palette.hint'), inner)))

    if (items.length === 0) {
      body.push(s.dim(t('palette.noMatch')))
      return panel(width, t('palette.title'), body, [s.dim(t('palette.footer'))])
    }

    // The window follows the cursor through the rows, headings included, so the
    // highlighted command is always on screen.
    const capacity = this.capacity()
    const cursorRow = rows.findIndex(row => row.kind === 'item' && row.index === this.cursor)
    const start = Math.max(0, Math.min(cursorRow - Math.floor(capacity / 2), rows.length - capacity))
    const window = rows.slice(start, start + capacity)
    for (const row of window) {
      if (row.kind === 'heading') {
        body.push(s.dim(row.text))
        continue
      }
      body.push(this.itemRow(row.entry, row.index === this.cursor, inner, hintWidth, s))
    }
    if (rows.length > capacity) body.push(s.dim(`  (${this.cursor + 1}/${items.length})`))
    return panel(width, t('palette.title'), body, [s.dim(t('palette.footer'))])
  }

  /** One command row: name, description, right-aligned shortcut. */
  private itemRow(
    entry: CatalogEntry,
    selected: boolean,
    inner: number,
    hintWidth: number,
    s: ReturnType<typeof buildStyles>,
  ): string {
    const usage = `/${entry.name}`
    const marker = selected ? '❯ ' : '  '
    const room = inner - 2 - visibleWidth(usage) - hintWidth - 2
    const detail = room < 8 ? '' : truncateToWidth(entry.description, room, '…')
    const head = `${marker}${selected ? s.accent(usage) : usage}`
    if (hintWidth === 0) {
      return truncateToWidth(detail === '' ? head : `${head}  ${detail}`, inner)
    }
    const used = visibleWidth(head) + (detail === '' ? 0 : 2 + visibleWidth(detail))
    const gap = Math.max(1, inner - used - hintWidth)
    return truncateToWidth(`${head}${detail === '' ? '' : `  ${detail}`}${' '.repeat(gap)}${s.dim(entry.hint)}`, inner)
  }

  handleInput(data: string): void {
    const entries = this.visible()
    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'escape')) {
      this.options.onResolve(undefined)
      return
    }
    if (listMove(data, 'up')) {
      this.cursor = Math.max(0, this.cursor - 1)
      return
    }
    if (listMove(data, 'down')) {
      this.cursor = Math.min(entries.length - 1, this.cursor + 1)
      return
    }
    if (matchesKey(data, 'backspace')) {
      this.query = this.query.slice(0, -1)
      this.cursor = 0
      return
    }
    if (matchesKey(data, 'ctrl+u')) {
      this.query = ''
      this.cursor = 0
      return
    }
    if (matchesKey(data, 'enter')) {
      this.options.onResolve(entries[this.cursor])
      return
    }
    // Typing keeps the cursor on the first match, which is what Enter runs.
    if (data.length === 1 && data.charCodeAt(0) >= 0x20) {
      this.query += data
      this.cursor = 0
    }
  }
}
