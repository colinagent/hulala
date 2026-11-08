/**
 * Help modal: the key reference, and the command list with its shortcuts.
 *
 * The words come from the message table and the keys come from the active keymap
 * (`config/keybindings.json`), so a rebound key is what this panel prints — the
 * one rule it shares with the startup banner and the command palette.
 *
 * The command list is curated rather than the whole catalog: the panel has to fit
 * above the composer on a short terminal, and the palette (`Shift-Cmd-P`) is the
 * complete, searchable version. Descriptions come from the same catalog the
 * palette and the `/` menu read.
 *
 * @module hulala-cli/tui/view/overlays/help
 */
import type { Component } from '@earendil-works/pi-tui'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { actionHint } from '../../../keymap.js'
import { catalogEntry, type CatalogEntry } from '../../commandCatalog.js'
import { t } from '../../i18n/index.js'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'

/** The commands this panel lists, in reading order. */
const COMMANDS = [
  'help', 'sessions', 'new', 'resume', 'model', 'thinking', 'login', 'rename', 'cancel',
  'status', 'editor', 'terminal', 'nvim', 'rail', 'chat', 'commands', 'keys',
  'language', 'quit',
] as const

/** Keys the rows of the command table reserve for the command itself. */
const USAGE_WIDTH = 24

/** The bindings one render reads, resolved once so a row cannot disagree. */
interface KeyLabels {
  readonly interrupt: string
  readonly cancel: string
  readonly quit: string
  readonly redraw: string
  readonly expand: string
  readonly thinking: string
  readonly rail: string
  readonly chat: string
  readonly terminal: string
  readonly editor: string
  readonly editorOnly: string
  readonly commands: string
  readonly focusLeft: string
  readonly focusRight: string
  readonly dividerLeft: string
  readonly dividerRight: string
}

function keyLabels(): KeyLabels {
  return {
    interrupt: actionHint('app.interrupt'),
    cancel: actionHint('app.cancel'),
    quit: actionHint('app.quit'),
    redraw: actionHint('app.redraw'),
    expand: actionHint('app.expand'),
    thinking: actionHint('app.thinking'),
    rail: actionHint('panel.rail'),
    chat: actionHint('panel.chat'),
    terminal: actionHint('panel.terminal'),
    editor: actionHint('panel.editor'),
    editorOnly: actionHint('panel.editorOnly'),
    commands: actionHint('panel.commands'),
    focusLeft: actionHint('panel.focusLeft'),
    focusRight: actionHint('panel.focusRight'),
    dividerLeft: actionHint('panel.dividerLeft'),
    dividerRight: actionHint('panel.dividerRight'),
  }
}

/** One command's usage cell: the word after the slash plus its argument hint. */
function usageOf(entry: CatalogEntry): string {
  return entry.argumentHint === undefined ? `/${entry.name}` : `/${entry.name} ${entry.argumentHint}`
}

/**
 * The shortcut column for one command.
 *
 * A command whose action the user disabled says so instead of leaving a blank
 * cell, which would read as "this command has no shortcut" rather than "you turned
 * it off". A command that never had one (`/status`) leaves the cell empty.
 */
function hintOf(entry: CatalogEntry): string {
  if (entry.hint !== '') return entry.hint
  return entry.action === undefined ? '' : t('keymap.none')
}

/**
 * One row of the command table: usage, what it does, and the shortcut that runs it.
 *
 * The shortcut is right-aligned so the column can be scanned downward; a panel too
 * narrow for both a readable description and the shortcut drops the shortcut
 * rather than the description.
 */
function commandRow(entry: CatalogEntry, inner: number, hintWidth: number): string {
  const usage = usageOf(entry).padEnd(USAGE_WIDTH)
  const hint = hintOf(entry)
  if (hintWidth === 0) return truncateToWidth(`${usage} ${entry.description}`, inner)
  const room = inner - USAGE_WIDTH - hintWidth - 2
  if (room < 8) return truncateToWidth(`${usage} ${entry.description}`, inner)
  const detail = truncateToWidth(entry.description, room, '…')
  const gap = Math.max(1, inner - USAGE_WIDTH - 1 - visibleWidth(detail) - hintWidth)
  return truncateToWidth(`${usage} ${detail}${' '.repeat(gap)}${hint}`, inner)
}

export interface HelpOverlayOptions {
  color: boolean
  /**
   * Terminal rows. The panel is placed over the whole screen and pi-tui clamps
   * it to this height, so the close hint must be inside that clamp: the body
   * gives way instead of the footer being cut off.
   */
  rows?(): number
  onClose(): void
}

export class HelpOverlay implements Component {
  private readonly options: HelpOverlayOptions

  constructor(options: HelpOverlayOptions) {
    this.options = options
  }

  invalidate(): void {}

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const panelWidth = width
    const inner = panelWidth - 4
    // Title and footer take two rows and both must survive: pi-tui clamps a
    // modal to the terminal height, so a short terminal drops trailing detail
    // rows instead of the close hint.
    const budget = Math.max(1, (this.options.rows?.() ?? 24) - 2)
    const entries = COMMANDS
      .map(name => catalogEntry(name))
      .filter((entry): entry is CatalogEntry => entry !== undefined)
    const hintWidth = Math.min(16, entries.reduce((max, entry) => Math.max(max, visibleWidth(hintOf(entry))), 0))
    const lines: string[] = []
    for (const entry of entries) lines.push(commandRow(entry, inner, hintWidth))
    const keys = keyLabels()
    lines.push(s.accent(t('help.keys')))
    for (const line of [
      t('help.key.submit'),
      t('help.key.move'),
      t('help.key.thinking', { thinking: keys.thinking }),
      t('help.key.escape', { interrupt: keys.interrupt }),
      t('help.key.exit', { cancel: keys.cancel, quit: keys.quit, redraw: keys.redraw, expand: keys.expand }),
      t('help.key.columns', {
        rail: keys.rail,
        chat: keys.chat,
        terminal: keys.terminal,
        editor: keys.editor,
        editorOnly: keys.editorOnly,
        dividerLeft: keys.dividerLeft,
        dividerRight: keys.dividerRight,
      }),
      t('help.key.railKeys', { rail: keys.rail, focusLeft: keys.focusLeft, focusRight: keys.focusRight }),
      t('help.key.rail'),
      t('help.key.more'),
      t('help.key.commands', { commands: keys.commands }),
      t('help.key.mouse'),
    ]) {
      lines.push(s.dim(truncateToWidth(line, inner)))
    }
    return panel(panelWidth, t('help.title'), lines.slice(0, budget), [s.dim(t('help.close'))])
  }

  handleInput(_data: string): void {
    this.options.onClose()
  }
}
