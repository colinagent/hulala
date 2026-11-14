/**
 * What a terminal's bytes mean, decoded once and in one place.
 *
 * A client that drives programs (Neovim over the UI protocol, a shell in a pty)
 * receives an undifferentiated byte stream and has to answer two questions for
 * every sequence: what did the user press, and what would the terminal have sent
 * the program? Both answers come from this module, because every input bug in a
 * terminal UI is one of these being decided twice — a mouse report typed into a
 * buffer because one layer did not recognise it, a Command chord inserted as
 * text because another layer only knew the legacy encoding.
 *
 * The decoder is **total**: every sequence becomes a {@link KeyInput}, and
 * anything unrecognised becomes `unknown`, which callers drop. Nothing falls
 * through to "treat it as text" — that is how `<35;58;41M` ends up in a buffer.
 *
 * The vocabulary, in the order the decoder tries it:
 *
 * - a bracketed paste (`ESC [ 200 ~ … ESC [ 201 ~`);
 * - an SGR mouse report (`ESC [ < b ; x ; y M|m`);
 * - a Kitty CSI-u key (`ESC [ code[:alt[:base]] [; mods] [: event] u`), which is
 *   how a terminal with the disambiguate flag reports Command, Ctrl-Shift and
 *   every other chord the legacy encoding cannot express;
 * - a legacy named key (`ESC [ … A`/`~`, `ESC O …`);
 * - a control byte (`\r`, `\t`, `\u0001`…), which is a key, not text;
 * - a printable run, which is text.
 *
 * @module hulala-cli/tui/input/keys
 */

/** One decoded input event. */
export type KeyInput =
  /** Text the user typed, printable and safe to send as text. */
  | { readonly kind: 'text'; readonly text: string }
  /**
   * One named key.
   *
   * `modifiers` is Neovim's order and spelling (`C-S-M-D-`): Ctrl, Shift, Alt,
   * Command. `kitty` records a press/repeat/release event when the terminal
   * reports one.
   */
  | { readonly kind: 'key'; readonly name: string; readonly modifiers: string; readonly event?: 'press' | 'repeat' | 'release' }
  /** A bracketed paste: the program's own paste, with its own semantics. */
  | { readonly kind: 'paste'; readonly text: string }
  /** A pointer report, in one-based cell coordinates as the protocol sends them. */
  | { readonly kind: 'mouse'; readonly code: number; readonly x: number; readonly y: number; readonly pressed: boolean }
  /** Bytes this decoder does not know; callers drop them instead of typing them. */
  | { readonly kind: 'unknown'; readonly raw: string }

/** Neovim's name for each legacy named key, by the sequence's final byte. */
const CURSOR_KEYS: Readonly<Record<string, string>> = {
  A: 'Up',
  B: 'Down',
  C: 'Right',
  D: 'Left',
  H: 'Home',
  F: 'End',
}

/** The numbered keys: `ESC [ <n> ~` and the same with modifiers. */
const NUMBERED_KEYS: Readonly<Record<string, string>> = {
  '1': 'Home',
  '2': 'Insert',
  '3': 'Del',
  '4': 'End',
  '5': 'PageUp',
  '6': 'PageDown',
  '7': 'Home',
  '8': 'End',
  '11': 'F1',
  '12': 'F2',
  '13': 'F3',
  '14': 'F4',
  '15': 'F5',
  '17': 'F6',
  '18': 'F7',
  '19': 'F8',
  '20': 'F9',
  '21': 'F10',
  '23': 'F11',
  '24': 'F12',
}

/** `ESC O <final>` keys: the application cursor keys and the first four F keys. */
const SS3_KEYS: Readonly<Record<string, string>> = {
  A: 'Up',
  B: 'Down',
  C: 'Right',
  D: 'Left',
  H: 'Home',
  F: 'End',
  P: 'F1',
  Q: 'F2',
  R: 'F3',
  S: 'F4',
}

/**
 * Kitty's functional codepoints, which it uses for keys without a character.
 *
 * F1–F12 and the cursor keys keep their legacy spelling under the disambiguate
 * flag; these are the ones whose legacy form would be ambiguous.
 */
const KITTY_FUNCTIONAL: Readonly<Record<number, string>> = {
  9: 'Tab',
  13: 'CR',
  27: 'Esc',
  32: 'Space',
  127: 'BS',
  57344: 'Esc',
  57345: 'CR',
  57346: 'Tab',
  57347: 'BS',
  57348: 'Insert',
  57349: 'Del',
  57350: 'Left',
  57351: 'Right',
  57352: 'Up',
  57353: 'Down',
  57354: 'PageUp',
  57355: 'PageDown',
  57356: 'Home',
  57357: 'End',
  57376: 'F13',
  57377: 'F14',
  57378: 'F15',
  57379: 'F16',
  57380: 'F17',
  57381: 'F18',
  57382: 'F19',
  57383: 'F20',
  57384: 'F21',
  57385: 'F22',
  57386: 'F23',
  57387: 'F24',
}

/**
 * The modifier prefix for a Kitty or xterm modifier field.
 *
 * Both encodings send `bits + 1`: 1 shift, 2 alt, 4 ctrl, 8 super, 16 hyper,
 * 32 meta. Neovim spells super `D-` (Command) and meta/alt `M-`.
 * @param value - the `;n` field.
 * @param named - whether the key has no character of its own, and therefore has
 *   to carry Shift explicitly (a printable codepoint already carries it).
 * @returns the prefix, e.g. `C-S-`.
 */
export function modifierPrefix(value: number, named: boolean): string {
  if (value <= 1) return ''
  const bits = value - 1
  let prefix = ''
  if ((bits & 4) !== 0) prefix += 'C-'
  if (named && (bits & 1) !== 0) prefix += 'S-'
  if ((bits & 2) !== 0) prefix += 'M-'
  if ((bits & 8) !== 0) prefix += 'D-'
  if ((bits & 16) !== 0) prefix += 'T-'
  return prefix
}

/** A complete SGR mouse report, as a terminal sends it. */
const SGR_MOUSE = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])$/u

/**
 * The head of one: everything a split read can deliver before the tail.
 *
 * `ESC [` and `ESC [ <` are heads too — a busy client can read stdin in one-byte
 * chunks, and a fragment handed on as text types `<35;58;41M` into a buffer.
 */
const SGR_MOUSE_HEAD = /^\u001b\[<?[\d;]*$/u

/**
 * Whether a fragment could still become a complete mouse report.
 *
 * A read can split a report anywhere, and a fragment delivered as text becomes
 * `<35;58;41M` in whatever has the keyboard. A transport that buffers input
 * uses this to hold the head instead.
 * @param fragment - the bytes held so far.
 * @returns true while more bytes could complete a report.
 */
export function isMouseReportHead(fragment: string): boolean {
  return SGR_MOUSE_HEAD.test(fragment)
}

/** Whether a sequence is a whole mouse report. */
export function isMouseReport(sequence: string): boolean {
  return SGR_MOUSE.test(sequence)
}

/** The markers a bracketed paste is wrapped in. */
const PASTE_START = '\u001b[200~'
const PASTE_END = '\u001b[201~'

/**
 * Whether a chunk opens a bracketed paste that has not ended yet.
 *
 * A paste's content is opaque — it can be megabytes and any bytes — so a read
 * boundary can fall anywhere inside it. The transport holds it until the end
 * marker arrives; decoding an unfinished paste would type its opening marker and
 * then its content as ordinary keys.
 * @param data - the bytes received so far.
 * @returns true when a start marker has no end marker after it.
 */
export function pasteIsIncomplete(data: string): boolean {
  const start = data.indexOf(PASTE_START)
  return start >= 0 && data.indexOf(PASTE_END, start + PASTE_START.length) < 0
}

/** Whether a chunk carries a whole bracketed paste and nothing else. */
export function isPaste(data: string): boolean {
  return data.startsWith(PASTE_START) && data.endsWith(PASTE_END) && !pasteIsIncomplete(data)
}

/** The named key a `CSI … u` sequence carries, and its modifiers. */
function decodeKitty(body: string): KeyInput | undefined {
  const match = /^(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?$/u.exec(body)
  if (match === null) return undefined
  const code = Number(match[1])
  const modifiers = modifierPrefix(match[4] === undefined ? 1 : Number(match[4]), KITTY_FUNCTIONAL[code] !== undefined)
  const event = match[5] === '2' ? 'repeat' as const : match[5] === '3' ? 'release' as const : 'press' as const
  const named = KITTY_FUNCTIONAL[code]
  if (named !== undefined) return { kind: 'key', name: named, modifiers, event }
  const text = String.fromCodePoint(code)
  // A codepoint with no modifier is text — that is what a plain keypress is. A
  // release is never text, even for a printable key, or letting go of a key
  // would type it.
  if (modifiers === '' && event === 'press') return { kind: 'text', text }
  return { kind: 'key', name: text === '<' ? 'lt' : text, modifiers, event }
}

/**
 * A legacy CSI or SS3 named key.
 *
 * The forms a terminal uses: `ESC [ A` (cursor), `ESC [ 1 ; 5 A` (with
 * modifiers), `ESC [ 3 ~` and `ESC [ 3 ; 5 ~` (numbered), `ESC O P` (application
 * cursor keys and F1–F4), and `ESC [ Z` (back-tab).
 */
function decodeLegacy(sequence: string): KeyInput | undefined {
  if (sequence === '\u001b[Z') return { kind: 'key', name: 'Tab', modifiers: 'S-' }
  const ss3 = /^\u001bO([A-Z])$/u.exec(sequence)
  if (ss3 !== null) {
    const name = SS3_KEYS[ss3[1] ?? '']
    return name === undefined ? undefined : { kind: 'key', name, modifiers: '' }
  }
  // The `:n` suffix is Kitty's press/repeat/release event, appended to any
  // sequence when the terminal reports event types.
  // xterm's modifyOtherKeys: `ESC [ 27 ; modifier ; codepoint ~`. It is how a
  // terminal reports a chord for a character that legacy encoding would send
  // bare — Ctrl-I, Shift-Space, a layout's own symbols.
  const other = /^\u001b\[27;(\d+);(\d+)~$/u.exec(sequence)
  if (other !== null) {
    const modifiers = modifierPrefix(Number(other[1]), false)
    const text = String.fromCodePoint(Number(other[2]))
    if (modifiers === '') return { kind: 'text', text }
    return { kind: 'key', name: text === '<' ? 'lt' : text, modifiers }
  }
  const csi = /^\u001b\[(\d*)(?:;(\d+))?(?::(\d+))?([A-Za-z~])$/u.exec(sequence)
  if (csi === null) return undefined
  const [, first = '', second, eventField, final = ''] = csi
  const modifiers = second === undefined ? '' : modifierPrefix(Number(second), true)
  const event = eventField === '2' ? 'repeat' as const : eventField === '3' ? 'release' as const : 'press' as const
  if (final === '~') {
    const name = NUMBERED_KEYS[first]
    return name === undefined ? undefined : { kind: 'key', name, modifiers, event }
  }
  const name = CURSOR_KEYS[final]
  if (name === undefined) return undefined
  // `ESC [ A` has no first parameter; `ESC [ 1 ; 5 A` has `1`, which is not a
  // key of its own but a placeholder the encoding requires.
  if (first !== '' && first !== '1') return undefined
  if (second === undefined && first === '1') return undefined
  return { kind: 'key', name, modifiers, event }
}

/** A control byte as the key it is. */
function controlKey(code: number): KeyInput {
  switch (code) {
    case 0x0d:
      return { kind: 'key', name: 'CR', modifiers: '' }
    case 0x0a:
      return { kind: 'key', name: 'NL', modifiers: '' }
    case 0x09:
      return { kind: 'key', name: 'Tab', modifiers: '' }
    case 0x7f:
      return { kind: 'key', name: 'BS', modifiers: '' }
    case 0x1b:
      return { kind: 'key', name: 'Esc', modifiers: '' }
    default:
      // ESC is handled by the caller; the rest are `C-a` … `C-_`.
      return { kind: 'key', name: String.fromCharCode(code + 0x60), modifiers: 'C-' }
  }
}

/**
 * Decode one chunk of terminal input.
 *
 * A chunk is whatever the terminal's read produced: one key, a run of pasted
 * text, or a report. It is decoded left to right, and text runs are coalesced so
 * typing costs one event rather than one per character.
 * @param data - the bytes, as UTF-16 code units from the read stream.
 * @returns one event per key, report or text run, in order.
 */
export function decodeKeys(data: string): KeyInput[] {
  if (data === '') return []
  const events: KeyInput[] = []
  let text = ''
  const flush = (): void => {
    if (text !== '') {
      events.push({ kind: 'text', text })
      text = ''
    }
  }
  for (let index = 0; index < data.length; index += 1) {
    const character = data[index] as string
    const code = character.codePointAt(0) ?? 0
    if (character !== '\u001b') {
      if (code < 0x20 || code === 0x7f) {
        flush()
        events.push(controlKey(code))
        continue
      }
      text += character
      continue
    }
    flush()
    // Everything after the escape is one sequence, to the first byte that ends
    // it. A lone escape is the Escape key.
    const rest = data.slice(index)
    const paste = /^\u001b\[200~([\s\S]*?)\u001b\[201~/u.exec(rest)
    if (paste !== null) {
      events.push({ kind: 'paste', text: paste[1] ?? '' })
      index += paste[0].length - 1
      continue
    }
    // OSC (colour and title replies), DCS and SOS end with BEL or ST and carry
    // no keys; decoding them as input would type a terminal's answer as text.
    const control = /^\u001b(?:[\]PX^_])(?:[^\u0007\u001b]*)(?:\u0007|\u001b\\)?/u.exec(rest)
    if (control !== null) {
      events.push({ kind: 'unknown', raw: control[0] })
      index += control[0].length - 1
      continue
    }
    const mouse = SGR_MOUSE.exec(rest)
    if (mouse !== null) {
      events.push({
        kind: 'mouse',
        code: Number(mouse[1]),
        x: Number(mouse[2]),
        y: Number(mouse[3]),
        pressed: mouse[4] === 'M',
      })
      index += mouse[0].length - 1
      continue
    }
    const kitty = /^\u001b\[([\d:;]+)u/u.exec(rest)
    if (kitty !== null) {
      const decoded = decodeKitty(kitty[1] ?? '')
      if (decoded !== undefined) {
        events.push(decoded)
        index += kitty[0].length - 1
        continue
      }
    }
    // A legacy sequence: the longest one the decoder knows, so `ESC [ 1 ; 5 A`
    // is not read as `ESC` followed by text.
    const legacy = /^\u001b(?:\[[\d;:]*[A-Za-z~]|O[A-Z])/u.exec(rest)
    if (legacy !== null) {
      const decoded = decodeLegacy(legacy[0])
      if (decoded !== undefined) {
        events.push(decoded)
        index += legacy[0].length - 1
        continue
      }
    }
    // A CSI or SS3 sequence this decoder does not name is still one sequence:
    // consuming it whole is what keeps half of it out of the buffer. ECMA-48
    // spells it `ESC [` parameters, intermediates, then one final byte.
    const foreign = /^\u001b(?:\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|O[\x40-\x7e])/u.exec(rest)
    if (foreign !== null) {
      events.push({ kind: 'unknown', raw: foreign[0] })
      index += foreign[0].length - 1
      continue
    }
    // A bare escape is the Escape key, and an escape followed by one character
    // is that key with Alt: the terminal folds the modifier into the byte, so
    // there is nothing else it can mean.
    const next = rest[1]
    if (next === undefined || next === '\u001b') {
      events.push({ kind: 'key', name: 'Esc', modifiers: '' })
      continue
    }
    if ((next.codePointAt(0) ?? 0) < 0x20 || next === '\u007f') {
      const base = controlKey(next.codePointAt(0) ?? 0)
      if (base.kind === 'key') events.push({ ...base, modifiers: `M-${base.modifiers}` })
      index += 1
      continue
    }
    events.push({ kind: 'key', name: next === '<' ? 'lt' : next, modifiers: 'M-' })
    index += 1
  }
  flush()
  return events
}

/**
 * Neovim's notation for one decoded event.
 *
 * Text goes as text; everything else is `<C-S-M-D-name>`. A `<` is escaped
 * because bare `<` in notation would start a key name.
 * @param input - one decoded event.
 * @returns the notation, or the empty string for events Neovim does not take
 *   as keys (mouse reports and pastes have their own API calls).
 */
export function notationOf(input: KeyInput): string {
  switch (input.kind) {
    case 'text':
      return input.text.replaceAll('<', '<lt>')
    case 'key':
      return input.name === 'lt' && input.modifiers !== ''
        ? `<${input.modifiers}lt>`
        : `<${input.modifiers}${input.name}>`
    case 'paste':
    case 'mouse':
    case 'unknown':
      return ''
  }
}

/**
 * Translate terminal bytes into Neovim key notation.
 *
 * The single-string form of {@link decodeKeys} and {@link notationOf}, kept for
 * callers that only have bytes: an unknown sequence contributes nothing instead
 * of being typed.
 * @param data - one keystroke, one sequence or a run of printable text.
 * @returns notation for `nvim_input`.
 */
export function keyNotation(data: string): string {
  return decodeKeys(data).map(notationOf).join('')
}
