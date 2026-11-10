/**
 * Slash-command row.
 *
 * One line per command the Host executed — icon, the command the user typed,
 * and how it settled — the same step row the DeepSeek Harness web transcript
 * draws for `command/run`/`command/done`. A manual `/compact` is the one
 * command with a body: its compaction summary is folded away until the reader
 * asks for it, and its settled line prefers the structured counts
 * ("Compacted 37 history items (~8200 tokens)") over the handler's own text.
 *
 * State is carried by foreground colour and the summary words, never by a
 * filled row, matching every other row in the transcript.
 *
 * @module hulala-cli/tui/view/commandRow
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui'
import type { TranscriptItem } from '../data/viewModel.js'
import { activeLanguage, t } from '../i18n/index.js'
import { iconBox } from './rowGlyph.js'
import { buildStyles } from './theme.js'

/** Leading glyph: a command, not a tool and not a turn. */
const ICON = '⌘'
/** Summary lines shown while expanded before the rest is hidden behind a count. */
const SUMMARY_LINES = 20
/** Indent of every wrapped continuation line. */
const INDENT = '  '

type CommandItem = Extract<TranscriptItem, { kind: 'command' }>

/** Whether this command has a body worth folding: a compaction summary. */
export function commandExpandable(item: CommandItem): boolean {
  return item.summary !== undefined
}

export class CommandRowView implements Component {
  /**
   * The drawn row, for one width, one disclosure state and one language.
   *
   * The transcript asks every row again on every repaint; comparing the inputs
   * keeps a long conversation's scroll cost out of the number of rows in it.
   */
  private cached: {
    width: number
    expanded: boolean
    gutter: string
    language: string
    status: CommandItem['status']
    name: string
    text: string | undefined
    summary: string | undefined
    shadowedItems: number | undefined
    shadowedTokens: number | undefined
    lines: string[]
  } | undefined

  constructor(
    private readonly item: CommandItem,
    private readonly color: boolean,
    private readonly expanded: () => boolean,
    private readonly gutter: () => string,
  ) {}

  invalidate(): void {
    this.cached = undefined
  }

  render(width: number): string[] {
    const expanded = this.expanded() && commandExpandable(this.item)
    const gutter = this.gutter()
    const language = activeLanguage()
    const cached = this.cached
    if (
      cached !== undefined
      && cached.width === width
      && cached.expanded === expanded
      && cached.gutter === gutter
      && cached.language === language
      && cached.status === this.item.status
      && cached.name === this.item.name
      && cached.text === this.item.text
      && cached.summary === this.item.summary
      && cached.shadowedItems === this.item.shadowedItems
      && cached.shadowedTokens === this.item.shadowedTokens
    ) return cached.lines
    const lines = this.draw(width, expanded, gutter)
    this.cached = {
      width,
      expanded,
      gutter,
      language,
      status: this.item.status,
      name: this.item.name,
      text: this.item.text,
      summary: this.item.summary,
      shadowedItems: this.item.shadowedItems,
      shadowedTokens: this.item.shadowedTokens,
      lines,
    }
    return lines
  }

  /**
   * The settled line's words.
   *
   * A compaction that folded structure into the row states its counts; every
   * other command keeps the handler's complete settlement text, which is what
   * the web client does too.
   */
  private summary(): { text: string; tone: 'dim' | 'error' } {
    const item = this.item
    if (item.status === 'running') {
      return { text: item.name === 'compact' ? t('command.compacting') : t('command.running'), tone: 'dim' }
    }
    if (item.status === 'error') return { text: item.text ?? t('command.failed'), tone: 'error' }
    if (item.shadowedItems !== undefined && item.shadowedTokens !== undefined) {
      return { text: t('command.compacted', { items: item.shadowedItems, tokens: item.shadowedTokens }), tone: 'dim' }
    }
    return { text: item.text ?? t('command.done'), tone: 'dim' }
  }

  private draw(width: number, expanded: boolean, gutter: string): string[] {
    const s = buildStyles(this.color)
    const inner = Math.max(1, width - visibleWidth(gutter))
    const marker = this.item.status === 'error' ? s.error
      : this.item.status === 'running' ? s.accent
        : s.dim
    const summary = this.summary()
    const tone = summary.tone === 'error' ? s.error : s.dim
    const title = this.item.name === '' ? t('command.title') : `/${this.item.name}`

    let line = `${marker(iconBox(ICON))} ${title}`
    const room = Math.max(1, inner - visibleWidth(line) - 3)
    if (summary.text !== '') line += ` · ${tone(truncateToWidth(summary.text, room, '…'))}`

    const lines = [`${gutter}${line}`]
    if (!expanded) return lines

    const summaryText = this.item.summary
    if (summaryText === undefined) return lines
    const bodyWidth = Math.max(1, width - INDENT.length * 2)
    const wrapped = wrapTextWithAnsi(summaryText, bodyWidth)
    const shown = wrapped.slice(0, SUMMARY_LINES)
    for (const bodyLine of shown) lines.push(`${INDENT}${INDENT}${s.dim(bodyLine)}`)
    if (wrapped.length > shown.length) {
      lines.push(`${INDENT}${INDENT}${s.dim(t('tool.moreLines', { n: wrapped.length - shown.length }))}`)
    }
    return lines
  }
}
