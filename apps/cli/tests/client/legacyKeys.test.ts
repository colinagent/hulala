import { expect, test } from 'bun:test'
import { legacyKeys } from '../../src/tui/pane/legacyKeys.js'

test('escape comes back as the one byte every program knows', () => {
  expect(legacyKeys('\u001b[27u')).toBe('\u001b')
})

test('control chords come back as their C0 bytes', () => {
  expect(legacyKeys('\u001b[99;5u')).toBe('\u0003') // Ctrl-C
  expect(legacyKeys('\u001b[119;5u')).toBe('\u0017') // Ctrl-W, Neovim's window prefix
  expect(legacyKeys('\u001b[113;5u')).toBe('\u0011') // Ctrl-Q
  expect(legacyKeys('\u001b[91;5u')).toBe('\u001b') // Ctrl-[, the same byte as Esc
  expect(legacyKeys('\u001b[93;5u')).toBe('\u001d') // Ctrl-]
  expect(legacyKeys('\u001b[92;5u')).toBe('\u001c') // Ctrl-\
})

test('the keys that only collide under the protocol keep their legacy byte', () => {
  expect(legacyKeys('\u001b[105;5u')).toBe('\t') // Ctrl-I
  expect(legacyKeys('\u001b[109;5u')).toBe('\r') // Ctrl-M
  expect(legacyKeys('\u001b[127;5u')).toBe('\u007f') // Ctrl-?
  expect(legacyKeys('\u001b[13;2u')).toBe('\r') // Shift-Enter
  expect(legacyKeys('\u001b[9;2u')).toBe('\u001b[Z') // Shift-Tab
})

test('alt chords keep their escape prefix', () => {
  expect(legacyKeys('\u001b[106;3u')).toBe('\u001bj') // Alt-j
  expect(legacyKeys('\u001b[13;7u')).toBe('\u001b\r') // Ctrl-Alt-Enter
})

test('Command belongs to the frame and never reaches a program', () => {
  expect(legacyKeys('\u001b[91;13u')).toBe('') // Cmd-Ctrl-[
  expect(legacyKeys('\u001b[93;13u')).toBe('')
})

test('modifyOtherKeys reports translate the same way', () => {
  expect(legacyKeys('\u001b[27;5;99~')).toBe('\u0003')
  expect(legacyKeys('\u001b[27;3;106~')).toBe('\u001bj')
})

test('everything the protocol did not rewrite passes through untouched', () => {
  for (const data of ['a', 'Type me', '\r', '\t', '\u007f', '\u001b[1;5D', '\u001b[15~', '\u001b[<0;3;4M', '\u001b[200~x\u001b[201~']) {
    expect(legacyKeys(data)).toBe(data)
  }
})

test('an unknown report is forwarded rather than swallowed', () => {
  // A codepoint with no legacy Ctrl form: the program gets the report itself.
  expect(legacyKeys('\u001b[945;5u')).toBe('\u001b[945;5u')
})
