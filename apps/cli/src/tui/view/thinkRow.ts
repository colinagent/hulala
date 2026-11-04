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
import { iconBox } from './rowGlyph.js'
import { buildStyles } from './theme.js'

/** How much reasoning the transcript shows. */
export type ReasoningMode = 'summary' | 'full' | 'hidden'

/** Leading glyph for a reasoning block. */
const ICON = '✳'
/** Indent of the expanded body. */
const PADDING = 2

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

  constructor(
    private readonly item: ReasoningItem,
    private readonly color: boolean,
    private readonly theme: MarkdownTheme,
    private readonly mode: () => ReasoningMode,
    private readonly gutter: () => string,
  ) {}

  invalidate(): void {
    this.markdown = undefined
  }

  render(width: number): string[] {
    const mode = this.mode()
    if (mode === 'hidden') return []
    const text = reasoningText(this.item.text)
    if (text.trim() === '') return []

    const s = buildStyles(this.color)
    const summary = this.item.streaming ? latestParagraphLine(text) : firstLine(text)
    const gutter = this.gutter()
    const head = `${this.item.streaming ? s.accent(iconBox(ICON)) : s.dim(iconBox(ICON))} Think`
    const room = Math.max(1, width - visibleWidth(gutter) - visibleWidth(head) - 3)
    const line = `${gutter}${summary === '' ? head : `${head} · ${s.dim(truncateToWidth(summary.replaceAll('**', ''), room, '…'))}`}`

    if (mode === 'summary') return [line]
    return [line, ...this.body(text, width)]
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
