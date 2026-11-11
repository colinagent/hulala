import { expect, test } from 'bun:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import { codeHighlighter, colourLines, grammarFor, languageForPath } from '../../src/tui/view/codeHighlight.js'
import { buildStyles } from '../../src/tui/view/theme.js'

/** The styles a coloured terminal gets, so tokens carry their escapes. */
const ink = (type: string, text: string): string => buildStyles(true).syntax(type, text)
/** The styles a plain terminal gets; the same text, no escapes. */
const plain = (type: string, text: string): string => buildStyles(false).syntax(type, text)

const escape = /\u001b\[[0-9;]*m/g

test('a fence language resolves through its aliases and known names', () => {
  for (const name of ['ts', 'tsx', 'typescript', 'TS']) expect(grammarFor(name)).toBeDefined()
  for (const name of ['sh', 'shell', 'zsh']) expect(grammarFor(name)).toBe(grammarFor('bash'))
  for (const name of ['python3', 'python']) expect(grammarFor(name)).toBe(grammarFor('py'))
  expect(grammarFor('rust')).toBe(grammarFor('rs'))
  // A fence that names nothing, or an unknown language, stays plain.
  expect(grammarFor(undefined)).toBeUndefined()
  expect(grammarFor('')).toBeUndefined()
  expect(grammarFor('text')).toBeUndefined()
  expect(grammarFor('nonsense')).toBeUndefined()
})

test('a highlighted block colours keywords, strings and comments apart', () => {
  const highlight = codeHighlighter(ink, () => 80)
  const [line] = highlight('const name = "value" // note', 'ts')
  expect(line).toBeDefined()
  const escapes = new Set(line!.match(escape) ?? [])
  // keyword, string and comment each open a different colour.
  expect(escapes.size).toBeGreaterThanOrEqual(4)
  expect(line!.replace(escape, '')).toBe('const name = "value" // note')
})

test('without colour the block is the source, unchanged', () => {
  const highlight = codeHighlighter(plain, () => 80)
  const lines = highlight('const name = "value" // note\nreturn name', 'ts')
  expect(lines).toEqual(['const name = "value" // note', 'return name'])
  for (const line of lines) expect(line).not.toMatch(escape)
})

test('an unknown language keeps its lines and wraps them like any text', () => {
  const highlight = codeHighlighter(plain, () => 30)
  const lines = highlight('abcdefghijklmnopqrstuvwxyz0123456789', 'nonsense')
  expect(lines.length).toBe(2)
  expect(lines.join('')).toBe('abcdefghijklmnopqrstuvwxyz0123456789')
})

test('a long line folds into the width the transcript leaves for code', () => {
  const width = 60
  const highlight = codeHighlighter(ink, () => width)
  const source = `const payload = ${JSON.stringify({ key: 'x'.repeat(160) })}`
  const lines = highlight(source, 'ts')
  // Six columns go to the block's indent and the component's padding.
  for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width - 6)
  // Folding is a display device: the space at each fold is dropped, as it is in
  // wrapped prose, and every other character survives in order.
  const strip = (text: string): string => text.replace(escape, '').replace(/ /g, '')
  expect(strip(lines.join(''))).toBe(strip(source))
})

test('a repeated call reuses the block and a resized column re-folds it', () => {
  const highlight = codeHighlighter(ink, () => 60)
  const first = highlight('const a = 1', 'ts')
  // The same block in the same width is one cache entry, not a second render.
  expect(highlight('const a = 1', 'ts')).toBe(first)

  let current = 60
  const resizable = codeHighlighter(ink, () => current)
  const wide = resizable('x'.repeat(200), 'plain')
  current = 40
  const narrow = resizable('x'.repeat(200), 'plain')
  expect(narrow.length).toBeGreaterThan(wide.length)
})

test('a block whose tokens span lines keeps every line', () => {
  const highlight = codeHighlighter(plain, () => 80)
  const source = '/* one\n   two */\nconst a = 1'
  expect(highlight(source, 'js')).toEqual(['/* one', '   two */', 'const a = 1'])
})

test('a path names a language by its extension, and nothing else guesses', () => {
  expect(languageForPath('src/app.ts')).toBe('ts')
  expect(languageForPath('src/app.tsx')).toBe('ts')
  expect(languageForPath('/work/notes/README.md')).toBe('md')
  expect(languageForPath('deploy/run.sh')).toBe('bash')
  expect(languageForPath('data/x.yml')).toBe('yaml')
  // A path with no language on the list stays uncoloured rather than guessed at.
  expect(languageForPath('notes.txt')).toBeUndefined()
  expect(languageForPath('Makefile')).toBeUndefined()
  expect(languageForPath(undefined)).toBeUndefined()
})

test('colourLines colours without folding, for a row that wraps its own text', () => {
  const long = `const payload = ${JSON.stringify({ key: 'x'.repeat(80) })}`
  const [line] = colourLines(long, 'ts', ink)
  expect(line!.replace(escape, '')).toBe(long)
  // A plain block is inked by the caller's own style, one line each.
  expect(colourLines('a\nb', 'nonsense', ink, (text) => `[${text}]`)).toEqual(['[a]', '[b]'])
})
