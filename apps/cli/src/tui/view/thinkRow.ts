/**
 * Reasoning row ("Think").
 *
 * A reasoning block is folded to its label plus the last few lines of the
 * thought: a streaming answer shows where the model has got to without printing
 * the whole wall, and the reader opens the full Markdown with a click or
 * `Ctrl-O`. The budget is a cap rather than a height — a short thought shows
 * every line it has.
 *
 * The tail (instead of the web transcript's one-line summary, or pi's full
 * block) is deliberate: the live end of a thought is the part that changes, and
 * a fixed window keeps a turn's geometry from growing as the model thinks.
 *
 * A block that carries nothing but a provider signature is not content and is
 * skipped entirely.
 *
 * @module hulala-cli/tui/view/thinkRow
 */
import { Markdown, type Component, type MarkdownTheme } from '@earendil-works/pi-tui'
import type { TranscriptItem } from '../data/viewModel.js'
import { activeLanguage, t } from '../i18n/index.js'
import { tailPreview } from './preview.js'
import { iconBox } from './rowGlyph.js'
import { buildStyles } from './theme.js'

/** How much reasoning the transcript shows. */
export type ReasoningMode = 'tail' | 'full' | 'hidden'

/** Leading glyph for a reasoning block. */
const ICON = '✳'
/** Indent of the expanded body and of the previewed lines. */
const PADDING = 4
/** Visual lines a folded block keeps from the end of the thought. */
const PREVIEW_LINES = 4

/** A row that draws nothing, shared so an empty render keeps its identity. */
const NO_LINES: string[] = []

type ReasoningItem = Extract<TranscriptItem, { kind: 'reasoning' }>

/**
 * Strip the provider signature the model returns ahead of its thought. A
 * partial signature prefix has no displayable content yet.
 */
export function reasoningText(text: string): string {
  if (text[0] !== '<') return text
  const opening = '<signature>'
  if (opening.startsWith(text)) return ''
  if (!text.startsWith(opening)) return text
  const closing = '</signature>'
  const end = text.indexOf(closing, opening.length)
  if (end === -1) return ''
  let start = end + closing.length
  while (start < text.length) {
    if (text[start] === '\n') start += 1
    else if (text[start] === '\r' && text[start + 1] === '\n') start += 2
    else break
  }
  return text.slice(start)
}

export class ThinkRow implements Component {
  private markdown: { text: string; component: Markdown } | undefined
  /**
   * The whole row, for one width and one mode.
   *
   * A frame that only scrolled must not re-derive the folded block: a long
   * conversation asks every row again on every wheel notch, and answering
   * "nothing changed" is the difference between a scroll and a redraw. The
   * language is part of the answer because the label comes from `t()`.
   */
  private cachedRender: {
    width: number
    mode: ReasoningMode
    text: string
    streaming: boolean
    gutter: string
    language: string
    lines: string[]
  } | undefined

  constructor(
    private readonly item: ReasoningItem,
    private readonly color: boolean,
    private readonly theme: MarkdownTheme,
    private readonly mode: () => ReasoningMode,
    private readonly gutter: () => string,
  ) {}

  invalidate(): void {
    this.markdown = undefined
    this.cachedRender = undefined
  }

  render(width: number): string[] {
    const mode = this.mode()
    if (mode === 'hidden') return NO_LINES
    const text = reasoningText(this.item.text)
    if (text.trim() === '') return NO_LINES

    const gutter = this.gutter()
    const language = activeLanguage()
    const cached = this.cachedRender
    if (
      cached !== undefined
      && cached.width === width
      && cached.mode === mode
      && cached.text === text
      && cached.streaming === this.item.streaming
      && cached.gutter === gutter
      && cached.language === language
    ) return cached.lines

    const lines = mode === 'full'
      ? [this.head(gutter, 0), ...this.body(text, width)]
      : this.tail(width, text, gutter)
    this.cachedRender = { width, mode, text, streaming: this.item.streaming, gutter, language, lines }
    return lines
  }

  /** `✳ Thinking`, the label row; `hidden` adds how many rows are folded away. */
  private head(gutter: string, hidden: number): string {
    const s = buildStyles(this.color)
    const label = `${this.item.streaming ? s.accent(iconBox(ICON)) : s.dim(iconBox(ICON))} ${t('think.label')}`
    const folded = hidden === 0 ? '' : ` · ${s.dim(t('think.moreLines', { n: hidden }))}`
    return `${gutter}${label}${folded}`
  }

  /**
   * The folded block: label plus the end of the thought.
   *
   * The lines are plain text with the emphasis markers removed, not Markdown: a
   * window into the middle of a document can start inside an unclosed fence,
   * and one stray marker would restyle every visible line.
   */
  private tail(width: number, text: string, gutter: string): string[] {
    const s = buildStyles(this.color)
    const inner = Math.max(1, width - PADDING)
    const preview = tailPreview(text, inner, PREVIEW_LINES)
    const indent = ' '.repeat(PADDING)
    return [
      this.head(gutter, preview.hidden),
      ...preview.lines.map(line => `${indent}${s.italic(s.dim(line.replaceAll('**', '')))}`),
    ]
  }

  private body(text: string, width: number): string[] {
    if (this.markdown === undefined || this.markdown.text !== text) {
      this.markdown = { text, component: new Markdown(text, PADDING, 0, this.theme, undefined, { renderLatex: true }) }
    }
    return this.markdown.component.render(width)
  }
}
