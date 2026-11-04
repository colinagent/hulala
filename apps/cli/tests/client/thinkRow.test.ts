import { expect, test } from 'bun:test'
import { latestParagraphLine, reasoningText } from '../../src/tui/view/thinkRow.js'

test('reasoningText strips a provider signature block', () => {
  expect(reasoningText('plain thought')).toBe('plain thought')
  expect(reasoningText('<signature>abc</signature>\nreal thought')).toBe('real thought')
  expect(reasoningText('<signature>abc</signature>\r\nreal thought')).toBe('real thought')
})

test('reasoningText hides a partial or unclosed signature', () => {
  expect(reasoningText('<sign')).toBe('')
  expect(reasoningText('<signature>payload-without-end')).toBe('')
})

test('latestParagraphLine waits for the first line of the newest paragraph', () => {
  expect(latestParagraphLine('first paragraph line\nmore')).toBe('first paragraph line')
  expect(latestParagraphLine('first\n\nsecond line\nmore')).toBe('second line')
  // A paragraph whose first line is still being written keeps the previous one.
  expect(latestParagraphLine('first\n\nsecond')).toBe('first')
  expect(latestParagraphLine('single line without newline')).toBe('')
  expect(latestParagraphLine('  \n\n  spaced  \nrest')).toBe('spaced')
})
