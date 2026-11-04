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
  private cached: { status: ToolStatus; result: string | undefined; row: ToolRow } | undefined

  constructor(
    private readonly item: ToolItem,
    private readonly roots: () => { cwd?: string | undefined; home?: string | undefined },
    private readonly color: boolean,
    private readonly expanded: () => boolean,
    private readonly gutter: () => string,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const s = buildStyles(this.color)
    const row = this.row()
    const expanded = this.expanded()
    const gutter = this.gutter()
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
      : row.exit.signal !== undefined ? `  ${s.error(`signal ${row.exit.signal}`)}`
        : `  ${s.error(`exit ${row.exit.code ?? '?'}`)}`

    let line = `${marker(iconBox(ICONS[row.variant]))} ${row.title}`
    if (row.summary !== '') {
      const room = Math.max(1, inner - visibleWidth(line) - visibleWidth(exit) - visibleWidth(duration) - 3)
      line += ` · ${tone(truncateToWidth(row.summary, room, '…'))}`
    }
    line = `${gutter}${line}${exit}${duration}`

    const lines = [line]
    if (!expanded) return lines

    if (row.command !== undefined) {
      const command = truncateToWidth(row.command, Math.max(1, inner - INDENT.length - 2), '…')
      lines.push(`${INDENT}${s.dim(`❯ ${command}`)}`)
    } else if (row.body !== undefined) {
      lines.push(...this.block('IN', row.body, width, text => s.dim(text)))
    }
    if (row.output !== undefined) {
      const label = row.command === undefined && row.body !== undefined ? 'OUT' : undefined
      lines.push(...this.block(label, row.output, width, text => s.dim(text)))
    }
    return lines
  }

  private row(): ToolRow {
    const cached = this.cached
    if (cached !== undefined && cached.status === this.item.status && cached.result === this.item.result) {
      return cached.row
    }
    const roots = this.roots()
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
    this.cached = { status: this.item.status, result: this.item.result, row }
    return row
  }

  /** Wrap one labelled body and cap it at the visible line budget. */
  private block(
    label: string | undefined,
    text: string,
    width: number,
    style: (text: string) => string,
  ): string[] {
    const lines: string[] = []
    if (label !== undefined) lines.push(`${INDENT}${style(label)}`)
    const inner = Math.max(1, width - INDENT.length * 2)
    const wrapped = wrapTextWithAnsi(text, inner)
    const shown = wrapped.slice(0, OUTPUT_LINES)
    for (const line of shown) lines.push(`${INDENT}${INDENT}${style(line)}`)
    if (wrapped.length > shown.length) {
      lines.push(`${INDENT}${INDENT}${style(`… +${wrapped.length - shown.length} lines`)}`)
    }
    return lines
  }

  private seconds(milliseconds: number): string {
    return `${(milliseconds / 1_000).toFixed(1)}s`
  }
}
