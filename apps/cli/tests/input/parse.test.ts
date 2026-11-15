/**
 * The input parser: a byte stream, cut anywhere, must parse the same way.
 *
 * The bug this guards against was invisible to every test we had, because a
 * report written in one piece parsed fine — and a real terminal's stream is cut
 * by whatever the kernel had when the frame read it. So the property here is
 * "every chunking yields the same pieces", which is what a buffer-first parser
 * buys and what a per-chunk sequence splitter cannot.
 */
import { expect, test } from 'bun:test'
import { InputParser } from '../../src/tui/input/parse.ts'

/** Feed one stream in chunks of `size`, then drain; the pieces in order. */
function parseChunked(stream: string, size: number): string[] {
  const parser = new InputParser()
  const pieces: string[] = []
  for (let index = 0; index < stream.length; index += size) {
    pieces.push(...parser.push(stream.slice(index, index + size)))
  }
  pieces.push(...parser.drain())
  return pieces
}

/** Every split point of a stream, as two writes. */
function parseSplit(stream: string, at: number): string[] {
  const parser = new InputParser()
  return [...parser.push(stream.slice(0, at)), ...parser.push(stream.slice(at)), ...parser.drain()]
}

const report = (x: number, y: number): string => `\u001b[<35;${String(x)};${String(y)}M`

test('a report survives every way the stream can be cut', () => {
  const stream = `${report(43, 38)}${report(42, 38)}${report(0, 5)}`
  const expected = [report(43, 38), report(42, 38), report(0, 5)]
  for (let size = 1; size <= 12; size += 1) expect(parseChunked(stream, size)).toEqual(expected)
  for (let at = 1; at < stream.length; at += 1) expect(parseSplit(stream, at)).toEqual(expected)
})

test('a report whose escape was lost is a report, not text', () => {
  // The shape a split read leaves: the escape is handed back as the Escape key
  // when the caller gives up on it, and the tail that follows is still a report.
  // Losing the gesture would be worse than an extra key; typing `[<35;43;38M` is
  // what must never happen.
  expect(parseSplit('\u001b', 1).concat(parseChunked('[<35;43;38M', 1)))
    .toEqual(['\u001b', '\u001b[<35;43;38M'])
  const parser = new InputParser()
  expect(parser.push('[<35;43;38M')).toEqual(['\u001b[<35;43;38M'])
})

test('keys, text and chords keep their order across cuts', () => {
  const stream = 'hello\u001b[A\u0001\u001bx\u001b[1;5C'
  for (const size of [1, 2, 3, 4, 7]) {
    expect(parseChunked(stream, size).join('')).toBe(stream)
  }
})

test('a paste is one piece, however it arrives', () => {
  const paste = '\u001b[200~two\nlines\u001b[201~'
  for (const size of [1, 5, 9]) expect(parseChunked(paste, size)).toEqual([paste])
  // Content that looks like a report stays content.
  const tricky = '\u001b[200~ESC [ < 0 ; 1 ; 1 M\u001b[201~'
  expect(parseChunked(tricky, 3)).toEqual([tricky])
})

test('an incomplete sequence is held, then handed back as keys', () => {
  const parser = new InputParser()
  expect(parser.push('\u001b')).toEqual([])
  expect(parser.pending()).toBe('\u001b')
  // The Escape key, once the caller gives up on the rest.
  expect(parser.drain()).toEqual(['\u001b'])

  const alt = new InputParser()
  expect(alt.push('\u001b[')).toEqual([])
  expect(alt.drain()).toEqual(['\u001b', '['])
})

test('a report that never finished is dropped, never typed', () => {
  const parser = new InputParser()
  expect(parser.push('\u001b[<35;4')).toEqual([])
  expect(parser.drain()).toEqual([])
  // A prefix longer than any real sequence is a broken stream.
  const broken = new InputParser()
  expect(broken.push(`\u001b[<${'1'.repeat(80)}`)).toEqual([])
  expect(broken.pending()).toBe('')
})

test('terminal replies are passed through as their own piece', () => {
  const osc = '\u001b]11;rgb:0000/0000/0000\u0007'
  expect(parseChunked(osc, 2)).toEqual([osc])
  const dcS = '\u001bP>|Ghostty 1.0\u001b\\'
  expect(parseChunked(dcS, 3)).toEqual([dcS])
})

test('an arrow key whose escape was read alone is still that arrow', () => {
  // The shape from a stalled frame: the escape reaches the frame as the Escape
  // key, and `[C` follows — typed as text it reads `[C` in the composer.
  const parser = new InputParser()
  expect(parser.push('\u001b')).toEqual([])
  expect(parser.drain()).toEqual(['\u001b'])
  expect(parser.push('[C')).toEqual(['\u001b[C'])
  // A typed `[C` without a preceding escape is two characters of text (the lone
  // bracket waits a moment first, in case it is a report).
  const typed = new InputParser()
  expect(typed.push('[')).toEqual([])
  expect(typed.push('C')).toEqual(['[', 'C'])
})

test('a sequence split across a stalled frame is rejoined', () => {
  const parser = new InputParser()
  expect(parser.push('\u001b')).toEqual([])
  expect(parser.pending()).toBe('\u001b')
  expect(parser.push('[')).toEqual([])
  expect(parser.push('D')).toEqual(['\u001b[D'])
})

test('the orphan window is the adapter clock, not wall time', () => {
  // After a bare Escape has been delivered as the Escape key, a tail that lost
  // it can still be recognised — but only inside one named window. The clock is
  // injected so this is a fact about the parser, not about how long the test
  // happened to sleep.
  let now = 0
  const within = new InputParser({ orphanWindowMs: 100, now: () => now })
  within.push('\u001b')
  expect(within.drain()).toEqual(['\u001b'])
  now = 99
  expect(within.push('[C')).toEqual(['\u001b[C'])

  const past = new InputParser({ orphanWindowMs: 100, now: () => now })
  past.push('\u001b')
  expect(past.drain()).toEqual(['\u001b'])
  // The escape was delivered at time 99; the window is 100ms, so 199 is the
  // first moment it is too late to call the tail an arrow key. It is dropped,
  // never typed: `[C` in a composer is the bug this parser exists to prevent.
  now = 199
  expect(past.push('[C')).toEqual([])
  expect(past.takeDrops()).toEqual(['[C'])
})

test('a held fragment says what it is, so the adapter can pick its window', () => {
  const parser = new InputParser()
  expect(parser.pendingKind()).toBe('none')
  parser.push('\u001b[')
  expect(parser.pendingKind()).toBe('sequence')
  expect(parser.drain()).toEqual(['\u001b', '['])
  parser.push('\u001b[<35;6')
  expect(parser.pendingKind()).toBe('report')
  parser.push('\u001b[200~a paste')
  expect(parser.pendingKind()).toBe('paste')
})

test('a tail past the window is dropped, and ordinary typing survives it', () => {
  // After the drop, the stale escape time is cleared: the user goes back to
  // typing real characters, and a literal `[` is text again.
  let now = 0
  const parser = new InputParser({ orphanWindowMs: 100, now: () => now })
  parser.push('\u001b')
  expect(parser.drain()).toEqual(['\u001b'])
  now = 150
  expect(parser.push('[D')).toEqual([])
  expect(parser.takeDrops()).toEqual(['[D'])
  now = 200
  expect(parser.push('[x')).toEqual(['[', 'x'])
  expect(parser.takeDrops()).toEqual([])
})

test('a person typing the two characters [C is not a tail', () => {
  // No escape was ever handed on, so the characters are what they are: text.
  const parser = new InputParser()
  expect(parser.push('[C')).toEqual(['[', 'C'])
})
