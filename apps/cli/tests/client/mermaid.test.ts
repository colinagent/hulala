import { expect, test } from 'bun:test'
import { mermaidMarkdown } from '../../src/tui/view/mermaid.js'

function block(source: string): string {
  return `\`\`\`mermaid\n${source}\n\`\`\`\n`
}

test('a Mermaid block is replaced by the diagram it draws', () => {
  const out = mermaidMarkdown(`Before\n\n${block('flowchart LR\n  A[Start] --> B[Done]')}\nAfter`, 80)
  expect(out).not.toContain('```mermaid')
  expect(out).toContain('Before')
  expect(out).toContain('After')
  // Box-drawing art, not the source, between the surrounding paragraphs.
  expect(out).toContain('┌')
  expect(out).toContain('Start')
  expect(out).not.toContain('A[Start]')
})

test('other fenced blocks are left exactly as written', () => {
  const source = `text\n\n\`\`\`ts\nconst x = 1\n\`\`\`\n\n${block('flowchart LR\n  A --> B')}`
  const out = mermaidMarkdown(source, 80)
  expect(out).toContain('```ts\nconst x = 1\n```')
})

test('a diagram the renderer does not know stays source', () => {
  const source = `\`\`\`mermaid\npie title Pets\n  "Dogs" : 386\n\`\`\`\n`
  expect(mermaidMarkdown(source, 80)).toBe(source)
})

test('art wider than the space available becomes a framed source block', () => {
  const out = mermaidMarkdown(block('flowchart LR\n  A --> B --> C --> D --> E --> F'), 40)
  expect(out).toContain('mermaid: flowchart')
  expect(out).toContain('A --> B --> C --> D --> E --> F')
})

test('an incomplete diagram warns only once the message has settled', () => {
  const source = block('flowchart LR\n  A --> ')
  const streaming = mermaidMarkdown(source, 80, { streaming: () => true })
  const settled = mermaidMarkdown(source, 80, { streaming: () => false })
  expect(streaming).not.toContain('not fully rendered')
  expect(settled).toContain('Mermaid diagram not fully rendered')
  // The partial drawing is still there: a diagram should appear while it is typed.
  expect(streaming).toContain('┌')
})

test('a message without Mermaid is returned untouched', () => {
  const source = '# Title\n\nSome text with `code`.\n'
  expect(mermaidMarkdown(source, 80)).toBe(source)
})
