/**
 * Mermaid diagrams in the conversation, drawn as Unicode art.
 *
 * The client has no browser, and the conversation is a grid of cells, so a
 * diagram can only be text. `grok-mermaid` turns the source into box-drawing
 * rows; this module feeds them back through the Markdown pipeline the transcript
 * already uses, so a diagram sits exactly where its code block was.
 *
 * Every row is emitted as an inline code span. Code spans are the only Markdown
 * construct that keeps a row's leading spaces — the layout of a diagram is
 * indentation — and that leaves underscores, asterisks and brackets inside a
 * node label as literal text instead of italicising or linking them.
 *
 * A block that cannot be drawn stays source: an unknown diagram type, a syntax
 * error, or art wider than the space available (there we frame the source, so
 * the reader sees why it is not a picture). Warnings are only reported once the
 * message has settled; while it streams, the renderer draws whatever parses,
 * which is what makes a diagram appear while its last edge is still being typed.
 *
 * @module hulala-cli/tui/view/mermaid
 */
import { Marked, type Token } from '@earendil-works/pi-tui'
import { render, sourceBox, type MermaidArt } from 'grok-mermaid'
import { t } from '../i18n/index.js'

const parser = new Marked()

/** A fenced block whose info string names Mermaid. */
function isMermaid(token: Token): token is Token & { type: 'code'; text: string; lang?: string } {
  if (token.type !== 'code') return false
  return token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() === 'mermaid'
}

/**
 * One diagram row as an inline code span.
 *
 * CommonMark needs a delimiter longer than any backtick run in the content, and
 * an empty span has no height, so a blank row keeps one no-break space. A span
 * that starts or ends with a backtick is padded by one space, which CommonMark
 * strips again.
 */
function codeSpan(row: string): string {
  const content = row === '' ? '\u00a0' : row
  const longest = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(longest + 1)
  const padding = content.startsWith('`') || content.endsWith('`') ? ' ' : ''
  return `${fence}${padding}${content}${padding}${fence}`
}

/** Diagram rows as a Markdown paragraph: one hard break per row. */
function artParagraph(art: MermaidArt): string {
  return `${art.plain.map(codeSpan).join('  \n')}\n`
}

export interface MermaidOptions {
  /** True while the message is still arriving; warnings wait for it to settle. */
  readonly streaming?: () => boolean
}

/**
 * Replace every top-level Mermaid block with the diagram it draws.
 *
 * @param markdown - the message source, before parsing.
 * @param width - columns available for content.
 * @param options - see {@link MermaidOptions}.
 * @returns the source with Mermaid blocks replaced, or the source unchanged.
 */
export function mermaidMarkdown(markdown: string, width: number, options: MermaidOptions = {}): string {
  // Most messages have no diagram at all: skip the lexer pass then.
  if (!markdown.includes('mermaid')) return markdown
  const tokens = parser.lexer(markdown)
  const out: string[] = []
  let replaced = false
  for (const token of tokens) {
    if (!isMermaid(token)) {
      out.push(token.raw)
      continue
    }
    const art = render(token.text)
    // Unknown type or unparsable source: keep what the model wrote.
    if (art === null) {
      out.push(token.raw)
      continue
    }
    replaced = true
    // Too wide to draw: a framed copy of the source says why, where a raw fence
    // would read as a diagram that failed to appear.
    out.push(artParagraph(art.width > width ? sourceBox(token.text, width) : art))
    if (art.warnings.length > 0 && options.streaming?.() !== true) {
      const extra = art.warnings.length > 1 ? ` (+${art.warnings.length - 1})` : ''
      out.push(`\n${t('mermaid.incomplete', { warning: `${art.warnings[0]}${extra}` })}\n`)
    }
  }
  return replaced ? out.join('') : markdown
}
