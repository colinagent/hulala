/**
 * Tool-call row.
 *
 * One line per call — icon, title, summary — exactly like the DeepSeek Harness
 * web transcript, followed by a *preview* of the body instead of nothing: a
 * text body keeps its first lines, a mutation row its applied `-`/`+` change.
 * The derivation itself lives in `data/toolRow.ts` and `data/diffRow.ts`; this
 * component only draws it and applies the line budgets.
 *
 * A body that fits its budget is shown whole; a longer one is folded to the
 * budget with a counted hint line, and the reader opens the rest with a click
 * or `Ctrl-O`. The budgets are visual lines, not source lines: one long line
 * (minified JSON) must not wrap across the whole screen.
 *
 * State is carried by foreground colour and a trailing capsule, never by a
 * filled row (product UI rule: selection and status use colour, not blocks).
 *
 * @module hulala-cli/tui/view/toolRow
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui'
import type { DiffRow, DiffStats } from '../data/diffRow.js'
import { type ToolRow, type ToolVariant, toolRow } from '../data/toolRow.js'
import type { ToolStatus, TranscriptItem } from '../data/viewModel.js'
import { activeLanguage, t } from '../i18n/index.js'
import { colourLines, languageForPath } from './codeHighlight.js'
import { headPreview } from './preview.js'
import { iconBox } from './rowGlyph.js'
import { buildStyles } from './theme.js'

/**
 * Family leading glyphs, chosen to match the web client's icon per family:
 * terminal prompt, document, pencil, magnifier, code brackets, sparkle.
 */
const ICONS: Readonly<Record<ToolVariant, string>> = {
  bash: '>_',
  read: '▤',
  write: '✎',
  edit: '✎',
  search: '⌕',
  code: '{}',
  others: '✦',
}

/** Output lines an expanded body shows before the rest is hidden behind a count. */
const OUTPUT_LINES = 20
/** Visual lines a folded text row keeps from the start of its output. */
const TEXT_PREVIEW_LINES = 6
/** Body lines a folded change shows, head and tail around a counted hint. */
const DIFF_PREVIEW_LINES = 9
/** Indent of every wrapped continuation and body line. */
const INDENT = '  '
type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>

export class ToolRowView implements Component {
  /** The derived row, rebuilt only when an input the derivation reads changed. */
  private cachedRow: {
    status: ToolStatus
    result: string | undefined
    errorCode: string | undefined
    meta: unknown
    cwd: string | undefined
    home: string | undefined
    row: ToolRow
  } | undefined
  /**
   * The drawn row, for one width, one disclosure state and one language.
   *
   * A frame scrolls the whole transcript through the viewport, so every row
   * asks again whether anything it draws changed; comparing the inputs is what
   * keeps a long conversation's scroll cost out of the number of rows in it.
   * The language is one of those inputs because the row's labels come from
   * `t()` at render time, and a switch only asks for a repaint.
   */
  private cachedRender: {
    width: number
    expanded: boolean
    gutter: string
    durationMs: number | undefined
    language: string
    row: ToolRow
    lines: string[]
  } | undefined

  constructor(
    private readonly item: ToolItem,
    private readonly roots: () => { cwd?: string | undefined; home?: string | undefined },
    private readonly color: boolean,
    private readonly expanded: () => boolean,
    private readonly gutter: () => string,
  ) {}

  invalidate(): void {
    this.cachedRow = undefined
    this.cachedRender = undefined
  }

  render(width: number): string[] {
    const row = this.row()
    const expanded = this.expanded()
    const gutter = this.gutter()
    const language = activeLanguage()
    const cached = this.cachedRender
    if (
      cached !== undefined
      && cached.width === width
      && cached.expanded === expanded
      && cached.gutter === gutter
      && cached.durationMs === this.item.durationMs
      && cached.language === language
      && cached.row === row
    ) return cached.lines
    const lines = this.draw(width, row, expanded, gutter)
    this.cachedRender = { width, expanded, gutter, durationMs: this.item.durationMs, language, row, lines }
    return lines
  }

  private draw(width: number, row: ToolRow, expanded: boolean, gutter: string): string[] {
    const s = buildStyles(this.color)
    const inner = Math.max(1, width - visibleWidth(gutter))
    const marker = row.state === 'error' ? s.error
      : row.state === 'stopped' ? s.warn
        : row.state === 'running' ? s.accent
          : s.dim
    const tone = row.state === 'error' ? s.error : row.state === 'stopped' ? s.warn : s.dim
    const duration = expanded && this.item.durationMs !== undefined
      ? `  ${s.dim(this.seconds(this.item.durationMs))}`
      : ''
    const exit = row.exit === undefined ? ''
      : row.exit.signal !== undefined ? `  ${s.error(t('tool.signal', { signal: row.exit.signal }))}`
        : `  ${s.error(t('tool.exit', { code: String(row.exit.code ?? '?') }))}`
    const stat = row.diff === undefined ? '' : this.stat(row.diff.stats)

    let line = `${marker(iconBox(ICONS[row.variant]))} ${row.title}`
    if (row.summary !== '') {
      const tail = visibleWidth(exit) + visibleWidth(duration) + visibleWidth(stat)
      const room = Math.max(1, inner - visibleWidth(line) - tail - 3)
      line += ` · ${tone(truncateToWidth(row.summary, room, '…'))}`
    }
    line = `${gutter}${line}${stat}${exit}${duration}`

    const lines = [line]
    // A mutation's change is what the reader came for, so it is drawn in both
    // states; the arguments it replaced said nothing about the file.
    if (row.diff !== undefined) {
      lines.push(...this.diffBody(row.diff, width, expanded))
      return lines
    }
    if (!expanded) {
      lines.push(...this.preview(row, width))
      return lines
    }

    // A file row's own text is code: the language comes from the path the call
    // named, and a path with no language on the list keeps the muted body ink.
    const fileLanguage = row.variant === 'read' ? languageForPath(row.filePath) : undefined
    if (row.command !== undefined) {
      const command = truncateToWidth(row.command, Math.max(1, inner - INDENT.length - 2), '…')
      lines.push(`${INDENT}${s.dim(`❯ ${command}`)}`)
    } else if (row.body !== undefined) {
      lines.push(...this.block(t('tool.in'), row.body, width, text => s.dim(text)))
    }
    if (row.output !== undefined) {
      const label = row.command === undefined && row.body !== undefined ? t('tool.out') : undefined
      const language = row.variant === 'read' ? fileLanguage : undefined
      lines.push(...this.block(label, row.output, width, text => s.dim(text), language))
    }
    return lines
  }

  /** `+3 -1`, in the change's own inks. */
  private stat(stats: DiffStats): string {
    const s = buildStyles(this.color)
    return `  ${s.ok(`+${stats.added}`)} ${s.error(`-${stats.removed}`)}`
  }

  /**
   * The folded body: what ran, then the start of what it printed.
   *
   * A shell row prints its command under the title, the way pi prints `bash
   * <command>` as the title itself: hulala keeps the model's description as the
   * summary, so the command has to appear somewhere, and a result without the
   * command that produced it is half a story. The command is skipped when the
   * summary already is the command.
   *
   * Only a thought previews its end — every other body is read from its first
   * line (`ls`, `cat`, a test header), and starting in the middle makes the
   * reader guess what they are looking at.
   */
  private preview(row: ToolRow, width: number): string[] {
    const s = buildStyles(this.color)
    const text = Math.max(1, width - INDENT.length * 2)
    const lines: string[] = []
    const showsCommand = row.command !== undefined && !row.summaryIsCommand
    if (showsCommand) {
      const command = truncateToWidth(row.command!, Math.max(1, text - 2), '…')
      lines.push(`${INDENT}${s.dim(`❯ ${command}`)}`)
    }
    // A read shows its header only (the window is in the summary), unless it
    // failed: then the error text is the one thing worth previewing.
    if (row.output === undefined || row.output.trim() === '') return lines
    if (row.variant === 'read' && row.state !== 'error') return lines
    const budget = TEXT_PREVIEW_LINES - (showsCommand ? 1 : 0)
    const body = headPreview(row.output, text, budget)
    const hint = body.hidden === 0 ? [] : [t('tool.moreLines', { n: body.hidden })]
    return [...lines, ...[...body.lines, ...hint].map(line => `${INDENT}${INDENT}${s.dim(line)}`)]
  }

  /**
   * The change, with each row keeping its marker.
   * A folded change shows its head and its tail around a counted hint, the
   * same split the web client's diff card draws; an open one shows all of it.
   */
  private diffBody(diff: { rows: DiffRow[]; stats: DiffStats }, width: number, expanded: boolean): string[] {
    const s = buildStyles(this.color)
    const indent = INDENT.length * 2
    const inner = Math.max(1, width - indent)
    const paint = (row: DiffRow): string => {
      switch (row.kind) {
        case 'path':
        case 'gap': return s.dim(row.text)
        case 'del': return `${s.error('-')} ${s.error(row.text)}`
        case 'add': return `${s.ok('+')} ${s.ok(row.text)}`
        case 'context': return `  ${s.dim(row.text)}`
      }
    }
    const fit = (text: string): string[] => expanded
      ? wrapTextWithAnsi(text, inner)
      : [truncateToWidth(text, inner, '…')]

    const rows = diff.rows
    const folded = !expanded && rows.length > DIFF_PREVIEW_LINES
    if (!folded) return rows.flatMap(row => fit(paint(row)).map(line => `${INDENT}${INDENT}${line}`))

    const head = Math.ceil(DIFF_PREVIEW_LINES / 2)
    const tail = DIFF_PREVIEW_LINES - head
    const hidden = rows.length - DIFF_PREVIEW_LINES
    const lines = rows.slice(0, head).flatMap(row => fit(paint(row)))
    lines.push(s.dim(t('tool.moreLines', { n: hidden })))
    lines.push(...rows.slice(rows.length - tail).flatMap(row => fit(paint(row))))
    return lines.map(line => `${INDENT}${INDENT}${line}`)
  }

  private row(): ToolRow {
    const roots = this.roots()
    const cached = this.cachedRow
    if (
      cached !== undefined
      && cached.status === this.item.status
      && cached.result === this.item.result
      && cached.errorCode === this.item.errorCode
      && cached.meta === this.item.meta
      && cached.cwd === roots.cwd
      && cached.home === roots.home
    ) return cached.row
    const row = toolRow({
      name: this.item.name,
      args: this.item.args,
      result: this.item.result,
      ...this.item.errorCode === undefined ? {} : { errorCode: this.item.errorCode },
      ...this.item.meta === undefined ? {} : { meta: this.item.meta },
      status: this.item.status,
      ...roots.cwd === undefined ? {} : { cwd: roots.cwd },
      ...roots.home === undefined ? {} : { home: roots.home },
    })
    this.cachedRow = {
      status: this.item.status,
      result: this.item.result,
      errorCode: this.item.errorCode,
      meta: this.item.meta,
      cwd: roots.cwd,
      home: roots.home,
      row,
    }
    return row
  }

  /**
   * Wrap one labelled body and cap it at the visible line budget.
   * @param language - highlight the body as this language instead of inking it flat.
   */
  private block(
    label: string | undefined,
    text: string,
    width: number,
    style: (text: string) => string,
    language?: string | undefined,
  ): string[] {
    const lines: string[] = []
    if (label !== undefined) lines.push(`${INDENT}${style(label)}`)
    const inner = Math.max(1, width - INDENT.length * 2)
    // A highlighted body carries its own colours, so the muted body ink steps
    // aside: dimming over a keyword's colour would wash both out.
    const source = language === undefined
      ? text
      : colourLines(text, language, (type, token) => buildStyles(this.color).syntax(type, token)).join('\n')
    const body = language === undefined ? style : (text: string): string => text
    const wrapped = wrapTextWithAnsi(source, inner)
    const shown = wrapped.slice(0, OUTPUT_LINES)
    for (const line of shown) lines.push(`${INDENT}${INDENT}${body(line)}`)
    if (wrapped.length > shown.length) {
      lines.push(`${INDENT}${INDENT}${style(t('tool.moreLines', { n: wrapped.length - shown.length }))}`)
    }
    return lines
  }

  private seconds(milliseconds: number): string {
    return `${(milliseconds / 1_000).toFixed(1)}s`
  }
}
