import { expect, test } from 'bun:test'
import { renderMermaid } from '../../src/tui/editor/mermaidRender.js'

test('a Mermaid source becomes box-drawing rows', () => {
  const { arts } = renderMermaid({ width: 80, sources: ['flowchart LR\n  A[Start] --> B[Done]'] })
  const rows = arts[0] ?? []
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.join('\n')).toContain('┌')
  expect(rows.join('\n')).toContain('Start')
  expect(rows.join('\n')).not.toContain('A[Start]')
})

test('a source the engine does not draw stays null, in order', () => {
  const { arts } = renderMermaid({
    width: 80,
    sources: ['flowchart LR\n  A --> B', 'pie title Pets\n  "Dogs" : 1', 'flowchart TD\n  C --> D'],
  })
  expect(arts[0]).not.toBeNull()
  expect(arts[1]).toBeNull()
  expect(arts[2]).not.toBeNull()
})

test('art too wide for the window becomes a framed source block', () => {
  const { arts } = renderMermaid({ width: 40, sources: ['flowchart LR\n  A --> B --> C --> D --> E --> F'] })
  const rows = (arts[0] ?? []).join('\n')
  expect(rows).toContain('mermaid: flowchart')
  expect(rows).toContain('A --> B --> C --> D --> E --> F')
})

test('a batch is capped so one message cannot stall the editor', () => {
  const sources = Array.from({ length: 40 }, () => 'flowchart LR\n  A --> B')
  const { arts } = renderMermaid({ width: 80, sources })
  expect(arts.length).toBe(32)
})
