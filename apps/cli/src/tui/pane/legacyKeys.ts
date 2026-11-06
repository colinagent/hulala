/**
 * Turning the terminal's extended key reports back into the bytes a pty wants.
 *
 * The client asks the outer terminal for the Kitty keyboard protocol's
 * "disambiguate escape codes" mode, which is the only way a macOS terminal will
 * ever report a Command chord — legacy encoding has no room for `super`. The
 * price is that the outer terminal now reports *this* program's keys as `CSI-u`
 * sequences (`CSI 99;5u` for `Ctrl-C`, `CSI 27u` for `Esc`).
 *
 * The programs in the sidebar columns — a shell and Neovim — run inside a pty
 * and were never told about that protocol: they expect the legacy bytes. This
 * module is the one translation between the two, so a keystroke means the same
 * thing before and after the protocol was switched on.
 *
 * Only the forms the protocol actually produces are translated; anything else is
 * passed through untouched, because it is already what the program expects.
 *
 * @module hulala-cli/tui/pane/legacyKeys
 */

/** `CSI <code>[:alt][:<base>][;<mods>[:<event>]]u`, the Kitty key report. */
const CSI_U = /^\u001b\[(\d+)(?::\d*)?(?::\d+)?(?:;(\d+))?(?::\d+)?u$/

/** `CSI 27 ;<mods> ;<code>~`, the modifyOtherKeys report for the same keys. */
const MODIFY_OTHER = /^\u001b\[27;(\d+);(\d+)~$/

/** Control characters the legacy encoding can produce, by unshifted codepoint. */
const CONTROL_BYTES: Record<number, number> = {
  0x40: 0x00, // @
  0x5b: 0x1b, // [
  0x5c: 0x1c, // \
  0x5d: 0x1d, // ]
  0x5e: 0x1e, // ^
  0x5f: 0x1f, // _
  0x2f: 0x1f, // /
  0x2d: 0x1f, // -
}

/**
 * The C0 byte a legacy terminal would have sent for Ctrl+key.
 * @param codepoint - the unshifted codepoint the report carries.
 * @returns the control byte, or undefined when Ctrl+key has no legacy form.
 */
function controlByte(codepoint: number): number | undefined {
  if (codepoint >= 0x61 && codepoint <= 0x7a) return codepoint - 0x60
  if (codepoint >= 0x41 && codepoint <= 0x5a) return codepoint - 0x40
  return CONTROL_BYTES[codepoint]
}

/**
 * The legacy bytes for one reported key, or undefined when the report is not a
 * key this translation knows.
 * @param codepoint - the key's unshifted codepoint.
 * @param mods - the modifier bitmask (`1` shift, `2` alt, `4` ctrl, `8` super).
 * @returns the bytes to write to the pty.
 */
function legacyFor(codepoint: number, mods: number): string | undefined {
  const shift = (mods & 1) !== 0
  const alt = (mods & 2) !== 0
  const ctrl = (mods & 4) !== 0
  const superKey = (mods & 8) !== 0
  const char = String.fromCodePoint(codepoint)
  // Alt is an escape prefix in legacy encoding, on top of whatever the key is.
  const prefix = alt ? '\u001b' : ''

  // Command is the frame's: a program in a column has no use for it, and a
  // half-understood sequence would only land in a buffer as text.
  if (superKey) return ''

  if (ctrl) {
    // Tab/Enter/Backspace are distinct keys under the protocol but not in
    // legacy encoding; they keep their legacy byte.
    if (codepoint === 0x09) return `${prefix}\t`
    if (codepoint === 0x0d) return `${prefix}\r`
    if (codepoint === 0x7f || codepoint === 0x08) return `${prefix}\u007f`
    const byte = controlByte(codepoint)
    if (byte === undefined) return undefined
    return `${prefix}${String.fromCharCode(byte)}`
  }

  if (alt) return `\u001b${char}`

  if (shift) {
    // Shift-Tab and Shift-Enter are the two legacy sequences a program can see.
    if (codepoint === 0x09) return '\u001b[Z'
    if (codepoint === 0x0d) return '\r'
    return char
  }

  // Escape is the one bare key the protocol renames: `CSI 27u` is `0x1b`.
  if (codepoint === 0x1b) return '\u001b'
  return undefined
}

/**
 * Translate one terminal key report into the bytes the column's program expects.
 *
 * Reports the protocol did not produce (`CSI 1;5D` arrows, text, paste, mouse)
 * are returned unchanged.
 * @param data - one input event as the terminal delivered it.
 * @returns the bytes to forward to the pty.
 */
export function legacyKeys(data: string): string {
  const kitty = CSI_U.exec(data)
  if (kitty !== null) {
    const codepoint = Number.parseInt(kitty[1]!, 10)
    const mods = kitty[2] === undefined ? 0 : Number.parseInt(kitty[2], 10) - 1
    return legacyFor(codepoint, mods) ?? data
  }
  const other = MODIFY_OTHER.exec(data)
  if (other !== null) {
    const mods = Number.parseInt(other[1]!, 10) - 1
    const codepoint = Number.parseInt(other[2]!, 10)
    return legacyFor(codepoint, mods) ?? data
  }
  return data
}
