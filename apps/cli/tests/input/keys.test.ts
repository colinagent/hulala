/**
 * The input vocabulary.
 *
 * These cases are the protocol's, not ours: legacy control bytes and CSI forms
 * from `api-ui-events.txt`'s neighbours in `tui.txt`, and the Kitty forms from
 * the keyboard protocol. They are what makes the two ends agree — a client that
 * decodes a chord one way and a program that expects another is how Command-C
 * used to be inserted as `<M-[>99;9u`.
 */
import { expect, test } from 'bun:test'
import { decodeKeys, isMouseReport, isMouseReportHead, keyNotation, modifierPrefix, notationOf } from '../../src/tui/input/keys.ts'

/** Everything one chunk decodes to, as compact strings. */
function decoded(data: string): string[] {
  return decodeKeys(data).map(event => {
    switch (event.kind) {
      case 'text': return `text:${event.text}`
      case 'paste': return `paste:${event.text}`
      case 'mouse': return `mouse:${String(event.code)};${String(event.x)};${String(event.y)}${event.pressed ? 'M' : 'm'}`
      case 'unknown': return `unknown:${event.raw}`
      case 'key': return `key:${event.modifiers}${event.name}${event.event === undefined || event.event === 'press' ? '' : `:${event.event}`}`
    }
  })
}

test('printable runs are text, and one chunk is one run', () => {
  expect(decoded('hello')).toEqual(['text:hello'])
  expect(decoded('a<')).toEqual(['text:a<'])
  // A `<` in notation is escaped, or it would start a key name.
  expect(keyNotation('a<')).toBe('a<lt>')
})

test('control bytes are keys, not text', () => {
  expect(decoded('\r')).toEqual(['key:CR'])
  expect(decoded('\t')).toEqual(['key:Tab'])
  expect(decoded('\u007f')).toEqual(['key:BS'])
  expect(decoded('\u0001')).toEqual(['key:C-a'])
  // Ctrl-M and Ctrl-[ arrive as their control bytes; the decoder must not turn
  // them into Enter and Escape is decided by the terminal, not here.
  expect(decoded('\u000d')).toEqual(['key:CR'])
})

test('the legacy named keys keep their form', () => {
  expect(decoded('\u001b[A')).toEqual(['key:Up'])
  expect(decoded('\u001b[1;5C')).toEqual(['key:C-Right'])
  expect(decoded('\u001b[3~')).toEqual(['key:Del'])
  expect(decoded('\u001b[3;5~')).toEqual(['key:C-Del'])
  expect(decoded('\u001b[15~')).toEqual(['key:F5'])
  expect(decoded('\u001b[24;5~')).toEqual(['key:C-F12'])
  expect(decoded('\u001b[Z')).toEqual(['key:S-Tab'])
  expect(decoded('\u001bOP')).toEqual(['key:F1'])
  expect(decoded('\u001bOH')).toEqual(['key:Home'])
})

test('an escape is a key, and an escape plus a character is that key with Alt', () => {
  expect(decoded('\u001b')).toEqual(['key:Esc'])
  expect(decoded('\u001bx')).toEqual(['key:M-x'])
  expect(decoded('\u001b\r')).toEqual(['key:M-CR'])
  // Two escapes are two keys: the second one is not the first one's Alt.
  expect(decoded('\u001b\u001b[A')).toEqual(['key:Esc', 'key:Up'])
})

test('the chords the disambiguate flag reports stay chords', () => {
  expect(decoded('\u001b[99;9u')).toEqual(['key:D-c'])
  expect(decoded('\u001b[1;9D')).toEqual(['key:D-Left'])
  expect(decoded('\u001b[1;6A')).toEqual(['key:C-S-Up'])
  expect(decoded('\u001b[1;13A')).toEqual(['key:C-D-Up'])
  expect(decoded('\u001b[91;13u')).toEqual(['key:C-D-['])
  expect(decoded('\u001b[109;5u')).toEqual(['key:C-m'])
  expect(decoded('\u001b[13;2u')).toEqual(['key:S-CR'])
  expect(decoded('\u001b[57352;9u')).toEqual(['key:D-Up'])
  // A plain codepoint with no modifier is the text it names.
  expect(decoded('\u001b[97u')).toEqual(['text:a'])
})

test('a release event is recorded rather than decoded as text', () => {
  // Flag 2 is not pushed today, but the decoder reads the event field, so a
  // terminal that sends it cannot make a release look like a typed character.
  expect(decoded('\u001b[97;1:3u')).toEqual(['key:a:release'])
  expect(decoded('\u001b[1;5:2A')).toEqual(['key:C-Up:repeat'])
  // A sequence this decoder cannot name is dropped whole: half of it must never
  // become text.
  expect(decoded('\u001b[1;5;9A')).toEqual(['unknown:\u001b[1;5;9A'])
})

test('mouse reports decode to cells, and their halves are recognisable', () => {
  expect(decoded('\u001b[<0;5;3M')).toEqual(['mouse:0;5;3M'])
  expect(decoded('\u001b[<0;5;3m')).toEqual(['mouse:0;5;3m'])
  expect(decoded('\u001b[<64;5;3M')).toEqual(['mouse:64;5;3M'])
  expect(isMouseReport('\u001b[<0;5;3M')).toBe(true)
  expect(isMouseReport('\u001b[<0;5;3')).toBe(false)
  // Every split a read can produce is still a head of one.
  const report = '\u001b[<35;58;41M'
  // A bare escape is the Escape key, not a head; everything from `ESC [` on is.
  for (let cut = 2; cut < report.length; cut += 1) {
    expect(isMouseReportHead(report.slice(0, cut))).toBe(true)
  }
  expect(isMouseReportHead('\u001b')).toBe(false)
})

test('a paste is one event, markers included only at the ends', () => {
  expect(decoded('\u001b[200~two\nlines\u001b[201~')).toEqual(['paste:two\nlines'])
  expect(decoded('x\u001b[200~p\u001b[201~y')).toEqual(['text:x', 'paste:p', 'text:y'])
})

test('an unknown sequence is dropped, never typed', () => {
  // OSC (a terminal title, a colour query) and DCS are somebody else's protocol.
  expect(decoded('\u001b]0;a title\u0007')).toEqual(['unknown:\u001b]0;a title\u0007'] as unknown as string[])
  const events = decodeKeys('\u001b]0;title\u0007')
  expect(events.some(event => event.kind === 'text')).toBe(false)
  expect(events.every(event => event.kind === 'unknown' || event.kind === 'key')).toBe(true)
  expect(keyNotation('\u001b]0;title\u0007')).toBe('')
})

test('modifier prefixes follow the protocol bitmask', () => {
  expect(modifierPrefix(1, true)).toBe('')
  expect(modifierPrefix(2, true)).toBe('S-')
  expect(modifierPrefix(5, true)).toBe('C-')
  expect(modifierPrefix(6, true)).toBe('C-S-')
  expect(modifierPrefix(3, true)).toBe('M-')
  // 4 is Shift+Alt: the field is a bitmask, not a list of names.
  expect(modifierPrefix(4, true)).toBe('S-M-')
  expect(modifierPrefix(9, true)).toBe('D-')
  expect(modifierPrefix(17, true)).toBe('T-')
  // A printable codepoint already carries the shift the terminal decided.
  expect(modifierPrefix(2, false)).toBe('')
})

test('notation is the inverse for every key the decoder names', () => {
  for (const sequence of ['\u001b[A', '\u001b[1;5C', '\u001b[3~', '\u001b[15~', '\u001bOP', '\u001bx', '\u001b']) {
    const notation = keyNotation(sequence)
    expect(notation.startsWith('<')).toBe(true)
    expect(notation.endsWith('>')).toBe(true)
  }
  for (const event of decodeKeys('abc\u001b[A')) expect(notationOf(event)).not.toContain('\u001b')
})

test('a report that lost its escape is still a report', () => {
  // The escape byte is the only thing missing, and no one types twelve
  // characters in one chunk that happen to spell a pointer report.
  expect(decoded('[<35;43;38M')).toEqual(['mouse:35;43;38M'])
  expect(decoded('[<0;5;3m')).toEqual(['mouse:0;5;3m'])
  expect(keyNotation('[<35;43;38M')).toBe('')
  // Ordinary text that merely starts with a bracket is still text.
  expect(decoded('[<3')).toEqual(['text:[<3'])
})
