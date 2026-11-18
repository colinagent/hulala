/**
 * Tool-call card.
 *
 * One step, two surfaces: a title line on the page (icon, name, summary), then a
 * card holding a *preview* of the body — a text body keeps its first lines, a
 * shell body its last ones, a mutation row its applied `-`/`+` change. The
 * derivation itself lives in `data/toolRow.ts` and `data/diffRow.ts`; this
 * component only draws it and applies the line budgets.
 *
 * The title sits on the page because it is the row's own name: it is read at a
 * glance while scrolling and lines up with a thought's title on the row above it.
 * The surface below it is the body, tinted by the call's own state — a green cast
 * once it lands, red if it failed, sand while it runs or after it was stopped —
 * but only by a suggestion, so the marker and the `exit 5` capsule remain the
 * loudest thing on the row. A call with nothing worth showing is the title alone.
 *
 * A body that fits its budget is shown whole; a longer one is folded to the
 * budget with a counted hint line, and the reader opens the rest with a click
 * or `Ctrl-O`. The budgets are visual lines, not source lines: one long line
 * (minified JSON) must not wrap across the whole screen.
 *
 * @module hulala-cli/tui/view/toolRow
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui'
import type { DiffRow, DiffStats } from '../data/diffRow.js'
import { type ToolRow, type ToolVariant, toolRow } from '../data/toolRow.js'
import type { ToolStatus, TranscriptItem } from '../data/viewModel.js'
import { activeLanguage, t } from '../i18n/index.js'
import { colourLines, languageForPath } from './codeHighlight.js'
import { headPreview, tailPreview } from './preview.js'
import { iconBox } from './rowGlyph.js'
import { buildStyles, type CardTone } from './theme.js'

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
/** Output lines a folded shell row keeps from the end of what it printed. */
const SHELL_PREVIEW_LINES = 5
/** Body rows a folded change shows before the rest is counted. */
const DIFF_PREVIEW_LINES = 5
/** Indent of every wrapped continuation and body line. */
const INDENT = '  '
/**
 * The prompt a shell row prints before its command.
 *
 * It is a dollar sign, not the composer's `❯`: a command under a card is what a
 * terminal shows, and the reader should not mistake it for a prompt they can
 * type into.
 */
const COMMAND_PROMPT = '$ '
/**
 * Card columns kept clear on the right.
 *
 * The surface itself runs to the column's edge; this is the text budget inside
 * it, so a line that measures one cell wider on the terminal than on our side
 * wraps in the page's margin instead of breaking the slab. There is no matching
 * left inset: the row's own gutter already holds two empty columns at the card's
 * edge, and adding one more would push every tool title one column right of a
 * thought's title on the row above it.
 */
const CARD_RIGHT_PAD = 1
type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>

/**
 * The tint a call's body wears.
 *
 * The card leans the way the call went — green once it has landed, red if it
 * failed, sand while it runs or after it was stopped — but only a suggestion: the
 * saturation is a tenth of pi's tool boxes, so a column of steps is still one
 * quiet surface with a cast, not a traffic light.
 * @param state - the call's state.
 * @returns the tone to draw the body's surface in.
 */
function toneOf(state: ToolStatus): CardTone {
  switch (state) {
    case 'ok': return 'ok'
    case 'error': return 'error'
    case 'stopped': return 'warn'
    case 'preparing':
    case 'running': return 'neutral'
  }
}

/**
 * Fold a command to the one terminal line the card has for it.
 *
 * `truncateToWidth` measures a newline as zero columns but keeps the byte, so a
 * heredoc or a `python3 - <<'PY'` script handed to it whole would carry raw LF
 * into the frame: the terminal moves down a row, the differential renderer still
 * believes it painted one unchanged row, and the text that landed below stays
 * on screen as a ghost. Show the first source line with a continuation mark
 * instead. `createBufferedOutput` also strips bare controls from frames; this
 * keeps the row readable rather than concatenating the script's lines.
 */
function commandPreview(command: string, width: number): string {
  const breakAt = command.search(/[\r\n]/u)
  if (breakAt < 0) return truncateToWidth(command, width, '…')
  const head = truncateToWidth(command.slice(0, breakAt), Math.max(1, width - 1), '')
  return `${head}…`
}

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
    // The title is a row on the page; the surface holds the body under it. The
    // title may use the whole column, the body keeps one cell clear on the right.
    const content = Math.max(1, width - CARD_RIGHT_PAD)
    const inner = Math.max(1, width - visibleWidth(gutter))
    // Page inks live on the page: the title is read at a glance while scrolling,
    // so a settled call keeps the terminal's own text ink and only a failure, a
    // stop or a live turn recolours it. Muted ink is for what a call printed.
    const ink: (text: string) => string = text => text
    const marker = row.state === 'error' ? s.error
      : row.state === 'stopped' ? s.warn
        : row.state === 'running' ? s.accent
          : ink
    // A settled call always says how long it took: the duration is one more
    // reading on the title line, not a reason to open the body.
    const duration = this.item.durationMs === undefined
      ? ''
      : `  ${marker(this.seconds(this.item.durationMs))}`
    const exit = row.exit === undefined ? ''
      : row.exit.signal !== undefined ? `  ${s.error(t('tool.signal', { signal: row.exit.signal }))}`
        : `  ${s.error(t('tool.exit', { code: String(row.exit.code ?? '?') }))}`
    const stat = row.diff === undefined ? '' : this.stat(row.diff.stats)

    let line = `${gutter}${marker(iconBox(ICONS[row.variant]))} ${row.title}`
    if (row.summary !== '') {
      const tail = visibleWidth(exit) + visibleWidth(duration) + visibleWidth(stat)
      const room = Math.max(1, inner - visibleWidth(line) - tail - 3)
      line += ` ${s.dim('·')} ${marker(truncateToWidth(row.summary, room, '…'))}`
    }
    line = `${line}${stat}${exit}${duration}`

    const body: string[] = []
    // A mutation's change is what the reader came for, so it is drawn in both
    // states; the arguments it replaced said nothing about the file.
    if (row.diff !== undefined) {
      body.push(...this.diffBody(row.diff, content, expanded))
    } else if (!expanded) {
      body.push(...this.preview(row, content))
    } else {
      // A file row's own text is code: the language comes from the path the call
      // named, and a path with no language on the list keeps the muted body ink.
      const fileLanguage = row.variant === 'read' ? languageForPath(row.filePath) : undefined
      if (row.command !== undefined) {
        const command = commandPreview(row.command!, Math.max(1, inner - INDENT.length - 2))
        body.push(`${INDENT}${s.cardMuted(`${COMMAND_PROMPT}${command}`)}`)
      } else if (row.body !== undefined) {
        body.push(...this.block(t('tool.in'), row.body, content, text => s.cardMuted(text)))
      }
      if (row.output !== undefined) {
        const label = row.command === undefined && row.body !== undefined ? t('tool.out') : undefined
        const language = row.variant === 'read' ? fileLanguage : undefined
        body.push(...this.block(label, row.output, content, text => s.cardMuted(text), language))
      }
    }
    // A call that printed nothing worth showing is a title and no card: an empty
    // slab would be a grey line claiming a body exists.
    return body.length === 0 ? [line] : [line, ...this.card(body, width, toneOf(row.state))]
  }

  /**
   * The body's surface: one continuous slab, padded with a blank row of its own
   * fill above and below.
   *
   * The padding rows are what keep the text off the slab's edge, and they are
   * drawn *inside* it (pi's `Box` does the same) so the block keeps one edge. A
   * row is filled to the column's full width and its text budgeted one cell
   * narrower, because a fill that stops a cell short of a blank row above it is
   * the notch the eye catches at the right edge.
   */
  private card(lines: string[], width: number, tone: CardTone): string[] {
    const s = buildStyles(this.color)
    const fill = (line: string): string => {
      const body = truncateToWidth(line, Math.max(1, width - CARD_RIGHT_PAD), '…')
      const pad = ' '.repeat(Math.max(0, width - visibleWidth(body)))
      return s.card(tone, `${body}${pad}`)
    }
    const blank = s.card(tone, ' '.repeat(Math.max(0, width)))
    return [blank, ...lines.map(fill), blank]
  }

  /** `+3 -1`, in the change's own inks — on the page, beside the title. */
  private stat(stats: DiffStats): string {
    const s = buildStyles(this.color)
    return `  ${s.ok(`+${stats.added}`)} ${s.error(`-${stats.removed}`)}`
  }

  /**
   * The folded body: what ran, then the part of what it printed worth seeing.
   *
   * A shell row prints its command under the title, the way pi prints `bash
   * <command>` as the title itself: hulala keeps the model's description as the
   * summary, so the command has to appear somewhere, and a result without the
   * command that produced it is half a story. The command is skipped when the
   * summary already is the command.
   *
   * A shell's answer is its *last* lines — a test's summary, a build's failure,
   * `tail`'s output — so that body keeps its end and counts what is above it.
   * Every other body is read from its first line (`ls`, `cat`, a search hit), and
   * starting in the middle makes the reader guess what they are looking at. A
   * thought is the other exception and keeps its tail in `thinkRow`.
   */
  private preview(row: ToolRow, width: number): string[] {
    const s = buildStyles(this.color)
    const text = Math.max(1, width - INDENT.length * 2)
    const lines: string[] = []
    const showsCommand = row.command !== undefined && !row.summaryIsCommand
    if (showsCommand) {
      const command = commandPreview(row.command!, Math.max(1, text - 2))
      lines.push(`${INDENT}${s.cardMuted(`${COMMAND_PROMPT}${command}`)}`)
    }
    // A read shows its header only (the window is in the summary), unless it
    // failed: then the error text is the one thing worth previewing.
    if (row.output === undefined || row.output.trim() === '') return lines
    if (row.variant === 'read' && row.state !== 'error') return lines
    if (row.variant === 'bash') {
      const body = tailPreview(row.output, text, SHELL_PREVIEW_LINES)
      if (body.hidden > 0) {
        lines.push(`${INDENT}${INDENT}${s.cardMuted(t('tool.earlierLines', { n: body.hidden }))}`)
      }
      for (const line of body.lines) lines.push(`${INDENT}${INDENT}${s.cardMuted(line)}`)
      return lines
    }
    const body = headPreview(row.output, text, TEXT_PREVIEW_LINES)
    const hint = body.hidden === 0 ? [] : [t('tool.moreLines', { n: body.hidden })]
    return [...lines, ...[...body.lines, ...hint].map(line => `${INDENT}${INDENT}${s.cardMuted(line)}`)]
  }

  /**
   * The change, with each row keeping its marker.
   * A folded change shows its first rows — the file, then the first edits — and
   * counts the rest; an open one shows all of it.
   */
  private diffBody(diff: { rows: DiffRow[]; stats: DiffStats }, width: number, expanded: boolean): string[] {
    const s = buildStyles(this.color)
    const indent = INDENT.length * 2
    const inner = Math.max(1, width - indent)
    const paint = (row: DiffRow): string => {
      switch (row.kind) {
        case 'path':
        case 'gap': return s.cardMuted(row.text)
        case 'del': return `${s.cardError('-')} ${s.cardError(row.text)}`
        case 'add': return `${s.cardOk('+')} ${s.cardOk(row.text)}`
        case 'context': return `  ${s.cardMuted(row.text)}`
      }
    }
    const fit = (text: string): string[] => expanded
      ? wrapTextWithAnsi(text, inner)
      : [truncateToWidth(text, inner, '…')]

    const rows = diff.rows
    const folded = !expanded && rows.length > DIFF_PREVIEW_LINES
    if (!folded) return rows.flatMap(row => fit(paint(row)).map(line => `${INDENT}${INDENT}${line}`))

    const lines = rows.slice(0, DIFF_PREVIEW_LINES).flatMap(row => fit(paint(row)))
    lines.push(s.cardMuted(t('tool.moreLines', { n: rows.length - DIFF_PREVIEW_LINES })))
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
    // aside: dimming over a keyword's colour would wash both out. A card body
    // takes the card's own token inks rather than the page's, because the card
    // is a surface with its own contrast.
    const source = language === undefined
      ? text
      : colourLines(text, language, (type, token) => buildStyles(this.color).cardSyntax(type, token)).join('\n')
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
