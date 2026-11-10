/**
 * Reasoning row ("Think").
 *
 * The web transcript folds a reasoning block into one line and shows the first
 * line of its last completed paragraph, so a streaming thought never shows a
 * half-written sentence. This component mirrors that rule and renders the whole
 * block as Markdown when the reader asks for it.
 *
 * A block that carries nothing but a provider signature is not content and is
 * skipped entirely.
 *
 * @module hulala-cli/tui/view/thinkRow
 */
import { Markdown, truncateToWidth, visibleWidth, type Component, type MarkdownTheme } from '@earendil-works/pi-tui'
import type { TranscriptItem } from '../data/viewModel.js'
import { activeLanguage, t } from '../i18n/index.js'
import { iconBox } from './rowGlyph.js'
import { buildStyles } from './theme.js'

/** How much reasoning the transcript shows. */
export type ReasoningMode = 'summary' | 'full' | 'hidden'

/** Leading glyph for a reasoning block. */
const ICON = '✳'
/** Indent of the expanded body. */
const PADDING = 2

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

/** First line of the last paragraph whose first line is already complete. */
export function latestParagraphLine(text: string): string {
  const paragraphs = text.split(/\r?\n(?:[\t ]*\r?\n)+/u)
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const paragraph = paragraphs[index] ?? ''
    const newline = paragraph.indexOf('\n')
    // The trailing paragraph is still being written until it has a newline.
    if (newline === -1 && index === paragraphs.length - 1) continue
    const line = (newline === -1 ? paragraph : paragraph.slice(0, newline)).trim()
    if (line !== '') return line
  }
  return ''
}

export class ThinkRow implements Component {
  private markdown: { text: string; component: Markdown } | undefined
  /**
   * The whole row, for one width and one mode.
   *
   * A frame that only scrolled must not re-derive the summary line: a long
   * conversation is a long list of rows asked again and again, and answering
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

    const head = this.head(width, text, gutter)
    const lines = mode === 'summary' ? [head] : [head, ...this.body(text, width)]
    this.cachedRender = { width, mode, text, streaming: this.item.streaming, gutter, language, lines }
    return lines
  }

  /** The summary row: glyph, label, and as much of the last paragraph as fits. */
  private head(width: number, text: string, gutter: string): string {
    const s = buildStyles(this.color)
    const summary = this.item.streaming ? latestParagraphLine(text) : firstLine(text)
    const label = `${this.item.streaming ? s.accent(iconBox(ICON)) : s.dim(iconBox(ICON))} ${t('think.label')}`
    const room = Math.max(1, width - visibleWidth(gutter) - visibleWidth(label) - 3)
    return `${gutter}${summary === '' ? label : `${label} · ${s.dim(truncateToWidth(summary.replaceAll('**', ''), room, '…'))}`}`
  }

  private body(text: string, width: number): string[] {
    if (this.markdown === undefined || this.markdown.text !== text) {
      this.markdown = { text, component: new Markdown(text, PADDING, 0, this.theme, undefined, { renderLatex: false }) }
    }
    return this.markdown.component.render(width)
  }
}

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}
