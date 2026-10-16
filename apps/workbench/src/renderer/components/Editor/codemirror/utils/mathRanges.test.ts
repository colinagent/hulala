import { expect, test } from 'bun:test'
import { markdownMathRanges } from './mathRanges'

test('recognizes inline, single-line and multiline display math with exact source spans', () => {
  const text = 'Inline $x^2$ text\n\n$$E=mc^2$$\n\n$$\n\\frac{1}{2}\n$$\n'
  const ranges = markdownMathRanges(text)
  expect(ranges.map(range => [range.formula, range.display])).toEqual([['x^2', false], ['E=mc^2', true], ['\\frac{1}{2}', true]])
  expect(ranges.map(range => text.slice(range.from, range.to))).toEqual(['$x^2$', '$$E=mc^2$$', '$$\n\\frac{1}{2}\n$$'])
})

test('does not render code, escaped currency, frontmatter or unclosed math', () => {
  expect(markdownMathRanges('---\nlabel: $x$\n---\n`$code$` and \\$5\n```text\n$$code$$\n```\n    $code$\n$$\nunclosed')).toEqual([])
})
