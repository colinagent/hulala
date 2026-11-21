/**
 * The Markdown a post may use, rendered as React elements — no HTML strings, no
 * `dangerouslySetInnerHTML`, and no Markdown dependency.
 *
 * The subset is the one the release posts are actually written in: level-2 and
 * level-3 headings, paragraphs, ordered and unordered lists, fenced code,
 * blockquotes, rules, and inline bold / italic / code / links. A construct outside it is a
 * build error rather than a paragraph that silently shows its own asterisks,
 * because a post is written once per release and nobody re-reads the rendering.
 *
 * A link is emitted only when its href is `http(s)`, site-relative or an anchor;
 * anything else (a `javascript:` URL in a Markdown file that came from a pull
 * request) renders as its text. The post is our own, but the rule costs one branch
 * and the site is public.
 *
 * @module hulala/website/blog/markdown
 */
import type { ReactNode } from 'react'

/** One block the renderer understands. */
type Block =
  | { readonly kind: 'heading'; readonly level: 2 | 3; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: 'code'; readonly language: string; readonly code: string }
  | { readonly kind: 'quote'; readonly lines: readonly string[] }
  | { readonly kind: 'rule' }

/** A fence that opens a code block, with its optional language. */
const FENCE = /^\s*```\s*([\w-]*)\s*$/
/** A heading of level 2 or 3. */
const HEADING = /^(#{2,3})\s+(.+)$/
/** A list item, ordered (`1.`) or not (`-`). */
const LIST_ITEM = /^(\s*)(?:([-*])|(\d+)\.)\s+(.+)$/
/** A blockquote line. */
const QUOTE = /^>\s?(.*)$/
/** A horizontal rule: three or more dashes and nothing else. */
const RULE = /^\s*(-{3,}|\*{3,})\s*$/

/**
 * Split a post into blocks.
 *
 * Fences are collected first so a `#` inside a shell comment is code, not a
 * heading. An unclosed fence and a level-1 heading both fail the build: the first
 * would swallow the rest of the post, and the second would compete with the title
 * the frontmatter already gave the page.
 * @param source - the Markdown body.
 * @returns the blocks, in document order.
 */
function parseBlocks(source: string): Block[] {
  const lines = source.split(/\r?\n/)
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '') {
      index++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence !== null) {
      const code: string[] = []
      index++
      while (index < lines.length && FENCE.exec(lines[index]) === null) {
        code.push(lines[index])
        index++
      }
      if (index >= lines.length) throw new Error(`markdown: the code fence opened at line ${index - code.length} never closes`)
      index++
      blocks.push({ kind: 'code', language: fence[1], code: code.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: heading[1].length === 2 ? 2 : 3, text: heading[2].trim() })
      index++
      continue
    }
    if (/^#\s+/.test(line)) throw new Error('markdown: a post body starts at "##"; the frontmatter title is the h1')
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      index++
      continue
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push((QUOTE.exec(lines[index]) as RegExpExecArray)[1])
        index++
      }
      blocks.push({ kind: 'quote', lines: quoted })
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (item !== null) {
      const ordered = item[3] !== undefined
      const items: string[] = []
      while (index < lines.length) {
        const next = LIST_ITEM.exec(lines[index])
        if (next === null || (next[3] !== undefined) !== ordered) break
        items.push(next[4].trim())
        index++
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length) {
      const next = lines[index]
      if (
        next.trim() === '' ||
        FENCE.test(next) ||
        HEADING.test(next) ||
        RULE.test(next) ||
        QUOTE.test(next) ||
        LIST_ITEM.test(next)
      ) {
        break
      }
      paragraph.push(next.trim())
      index++
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }
  return blocks
}

/** An `id` for a heading, so a post can link to its own sections. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

/** Whether a Markdown link href may become an actual link. */
function linkHref(href: string): string | undefined {
  return /^(?:https?:\/\/|\/|#)/.test(href) ? href : undefined
}

/** One inline construct the renderer understands: bold before italic, so `**` wins. */
const INLINE = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g

/**
 * Render the inline constructs of one paragraph or list item.
 * @param text - the text of one block.
 * @returns the text, with bold, code and links as elements.
 */
export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0
    if (start > cursor) nodes.push(text.slice(cursor, start))
    const [, bold, italic, code, label, href] = match
    if (bold !== undefined) nodes.push(<strong key={nodes.length}>{bold}</strong>)
    else if (italic !== undefined) nodes.push(<em key={nodes.length}>{italic}</em>)
    else if (code !== undefined) nodes.push(<code key={nodes.length}>{code}</code>)
    else {
      const target = linkHref(href)
      nodes.push(
        target === undefined ? (
          label
        ) : (
          <a key={nodes.length} href={target} rel={target.startsWith('http') ? 'noreferrer' : undefined} target={target.startsWith('http') ? '_blank' : undefined}>
            {label}
          </a>
        ),
      )
    }
    cursor = start + match[0].length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

/**
 * Render a post body.
 * @param source - the Markdown body, frontmatter already removed.
 * @returns the body as React elements, ready for a `prose` container.
 */
export function renderMarkdown(source: string): ReactNode[] {
  return parseBlocks(source).map((block, index) => {
    switch (block.kind) {
      case 'heading': {
        const Heading = block.level === 2 ? 'h2' : 'h3'
        return (
          <Heading id={headingId(block.text)} key={index}>
            {renderInline(block.text)}
          </Heading>
        )
      }
      case 'paragraph':
        return <p key={index}>{renderInline(block.text)}</p>
      case 'list': {
        const List = block.ordered ? 'ol' : 'ul'
        return (
          <List key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </List>
        )
      }
      case 'code':
        return (
          <pre key={index} data-language={block.language === '' ? undefined : block.language}>
            <code>{block.code}</code>
          </pre>
        )
      case 'quote':
        return (
          <blockquote key={index}>
            {block.lines.map((line, lineIndex) => (
              <p key={lineIndex}>{renderInline(line)}</p>
            ))}
          </blockquote>
        )
      case 'rule':
        return <hr key={index} />
    }
  })
}
