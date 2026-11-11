/**
 * Tool-call row.
 *
 * One line per call — icon, title, summary — exactly like the DeepSeek Harness
 * web transcript, with the argument body and the output folded away until the
 * reader asks for them. The derivation itself lives in `data/toolRow.ts`; this
 * component only draws it.
 *
 * State is carried by foreground colour and a trailing capsule, never by a
 * filled row (product UI rule: selection and status use colour, not blocks).
 *
 * @module hulala-cli/tui/view/toolRow
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui'
import { type ToolRow, type ToolVariant, toolRow } from '../data/toolRow.js'
import type { ToolStatus, TranscriptItem } from '../data/viewModel.js'
import { activeLanguage, t } from '../i18n/index.js'
import { colourLines, languageForPath } from './codeHighlight.js'
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

/** Output lines shown while expanded before the rest is hidden behind a count. */
const OUTPUT_LINES = 20
/** Indent of every wrapped continuation and expanded body line. */
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

    let line = `${marker(iconBox(ICONS[row.variant]))} ${row.title}`
    if (row.summary !== '') {
      const room = Math.max(1, inner - visibleWidth(line) - visibleWidth(exit) - visibleWidth(duration) - 3)
      line += ` · ${tone(truncateToWidth(row.summary, room, '…'))}`
    }
    line = `${gutter}${line}${exit}${duration}`

    const lines = [line]
    if (!expanded) return lines

    // A file row's own text is code: the language comes from the path the call
    // named, and a path with no language on the list keeps the muted body ink.
    const fileLanguage = row.variant === 'read' || row.variant === 'write'
      ? languageForPath(row.filePath)
      : undefined
    if (row.command !== undefined) {
      const command = truncateToWidth(row.command, Math.max(1, inner - INDENT.length - 2), '…')
      lines.push(`${INDENT}${s.dim(`❯ ${command}`)}`)
    } else if (row.body !== undefined) {
      const language = row.variant === 'write' ? fileLanguage : undefined
      lines.push(...this.block(t('tool.in'), row.body, width, text => s.dim(text), language))
    }
    if (row.output !== undefined) {
      const label = row.command === undefined && row.body !== undefined ? t('tool.out') : undefined
      const language = row.variant === 'read' ? fileLanguage : undefined
      lines.push(...this.block(label, row.output, width, text => s.dim(text), language))
    }
    return lines
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
