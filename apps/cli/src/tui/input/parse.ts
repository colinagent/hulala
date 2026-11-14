/**
 * The bytes a terminal sends, parsed into the pieces a frame can act on.
 *
 * A terminal does not send messages; it sends a byte stream that happens to be
 * cut at whatever boundary the kernel had when the program read it. Everything a
 * UI does with input goes wrong in the same way when that is forgotten: a report
 * split after its escape reaches the frame as an Escape key and twelve
 * characters, and those characters are typed into whatever has the keyboard.
 *
 * So this parser keeps a buffer and never guesses. It returns only what is
 * certainly complete, holds a prefix that could still grow into a sequence, and
 * hands back what is left as keys when the frame decides the rest is late.
 * Nothing here depends on how the bytes were chunked — the same stream split at
 * every possible boundary must produce the same pieces — which is why it is
 * tested that way.
 *
 * The vocabulary:
 *
 * - a bracketed paste, markers included;
 * - an SGR mouse report (`ESC [ < b ; x ; y M|m`), and one that lost its escape;
 * - a CSI or SS3 sequence (arrows, function keys, modifiers);
 * - an OSC, DCS, APC, PM or SOS string, for a terminal's own replies;
 * - a lone escape with one more character, which is an Alt chord;
 * - anything else, which is text.
 *
 * @module hulala-cli/tui/input/parse
 */

/** A report, as a terminal sends it. */
const REPORT = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])/u

/** The same report with its escape byte lost, which a split read produces. */
const ORPHAN_REPORT = /^\[<(\d+);(\d+);(\d+)([Mm])/u

/** A prefix of one, which must be held instead of being typed. */
const ORPHAN_HEAD = /^\[<?[\d;]*$/u

/** A CSI body: parameters, then intermediates, then one final byte. */
const CSI = /^\u001b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/u

/** A prefix of a CSI sequence, still waiting for its final byte. */
const CSI_HEAD = /^\u001b\[[\x30-\x3f]*[\x20-\x2f]*$/u

/** An application-mode cursor key or F1–F4. */
const SS3 = /^\u001bO[\x40-\x7e]/u

/** The head of one. */
const SS3_HEAD = /^\u001bO$/u

/** A control string: OSC, DCS, APC, PM or SOS. */
const CONTROL_STRING = /^\u001b[\]PX^_]/u

/** The terminator of one: BEL or ST. */
const CONTROL_STRING_END = /\u0007|\u001b\\/u

/** A bracketed paste. */
const PASTE_START = '\u001b[200~'
const PASTE_END = '\u001b[201~'

/** How much held input is worth keeping; past this it is not a sequence. */
const MAX_HELD = 8 * 1024 * 1024

/**
 * The longest prefix worth holding for a sequence's remainder.
 *
 * A real CSI or report is a few dozen characters at most — three numbers and a
 * final byte. A longer one is a broken stream, and holding it would grow a buffer
 * on the strength of whatever arrives next.
 */
const MAX_HELD_PREFIX = 64

/**
 * The incremental parser.
 *
 * One instance per terminal. `push` is called with exactly the bytes a read
 * produced and returns every piece that is complete; whatever is left stays in
 * the buffer until the next read or until `drain` is called.
 */
export class InputParser {
  private held = ''

  /** Bytes waiting for their remainder. */
  pending(): string {
    return this.held
  }

  /**
   * Feed one read.
   * @param chunk - the bytes, as UTF-16 code units from the stream.
   * @returns the complete pieces, in order.
   */
  push(chunk: string): string[] {
    if (chunk === '') return []
    this.held += chunk
    if (this.held.length > MAX_HELD) {
      // Not a sequence, or a paste that never ends: give the bytes back rather
      // than grow a buffer on the strength of what might arrive next.
      const overflow = this.held
      this.held = ''
      return [overflow]
    }
    const pieces: string[] = []
    for (;;) {
      const piece = this.take()
      if (piece === undefined) break
      pieces.push(piece)
    }
    return pieces
  }

  /**
   * Take what is still held, as the keys it can only be.
   *
   * Called when the frame has waited long enough: a lone escape is the Escape
   * key, an Alt chord is delivered as it stands, and a report whose tail never
   * came is dropped — half a mouse report is never typing.
   * @returns the pieces to deliver, in order.
   */
  drain(): string[] {
    const held = this.held
    this.held = ''
    if (held === '') return []
    if (held === '\u001b') return ['\u001b']
    // A report whose tail never came is dropped: half a mouse report is not
    // typing, and delivering it would put `[<35;` in whatever has the keyboard.
    if (held.includes('<') && /^\u001b?\[/u.test(held)) return []
    // An escape and whatever followed it are two keys: the escape is the Escape
    // key (that is what it meant before the rest arrived), and the rest is text.
    if (held.startsWith('\u001b') && held.length > 1) return ['\u001b', held.slice(1)]
    // Anything else was a key or a chord that simply stopped here.
    return [held]
  }

  /**
   * Take one complete piece off the front of the buffer.
   * @returns the piece, or undefined when the buffer holds only a prefix.
   */
  private take(): string | undefined {
    if (this.held === '') return undefined
    if (this.held.startsWith(PASTE_START)) {
      const end = this.held.indexOf(PASTE_END, PASTE_START.length)
      if (end === -1) return undefined
      const piece = this.held.slice(0, end + PASTE_END.length)
      this.held = this.held.slice(piece.length)
      return piece
    }
    if (this.held.length > MAX_HELD_PREFIX && (CSI_HEAD.test(this.held) || ORPHAN_HEAD.test(this.held))) {
      // Not a sequence anyone sent: drop it instead of waiting for more.
      this.held = ''
      return undefined
    }
    if (this.held.startsWith('\u001b')) return this.takeEscape()
    // A report whose escape was lost: the tail is whole in one read, so it is
    // recognised at once and never becomes text. The escape is restored because
    // everything above this parser reads a report as one sequence.
    const orphan = ORPHAN_REPORT.exec(this.held)
    if (orphan !== null) return `\u001b${this.cut(orphan[0].length)}`
    if (ORPHAN_HEAD.test(this.held) && this.held.length < 24) return undefined
    return this.takeText()
  }

  /** A piece that begins with an escape. */
  private takeEscape(): string | undefined {
    const report = REPORT.exec(this.held)
    if (report !== null) return this.cut(report[0].length)
    const csi = CSI.exec(this.held)
    if (csi !== null) return this.cut(csi[0].length)
    if (CONTROL_STRING.test(this.held)) {
      const end = CONTROL_STRING_END.exec(this.held.slice(2))
      if (end === null) return undefined
      return this.cut(2 + end.index + end[0].length)
    }
    const ss3 = SS3.exec(this.held)
    if (ss3 !== null) return this.cut(ss3[0].length)
    // A prefix that could still become a sequence is held, never guessed at: a
    // lone escape may be a report or a key, and `ESC [` may be Alt-`[` or the
    // start of every CSI. The caller's timeout is what resolves them.
    if (this.held.length === 1) return undefined
    if (CSI_HEAD.test(this.held) || SS3_HEAD.test(this.held)) return undefined
    if (CONTROL_STRING.test(this.held)) return undefined
    // ESC plus one character is an Alt chord; more is the Alt chord and the text
    // that followed it.
    const second = this.held.codePointAt(1) ?? 0
    const width = second > 0xffff ? 3 : 2
    if (this.held.length < width) return undefined
    return this.cut(width)
  }

  /**
   * One character, which is one key press to everything above this parser.
   *
   * A run of text is not one event: the frame matches keybindings and an editor
   * treats `\r` as Enter only when it arrives on its own. This is why the pieces
   * are characters, exactly as the renderer's own buffer emitted them.
   */
  private takeText(): string | undefined {
    // A report tail can begin anywhere in the stream once its escape was read
    // separately, so a prefix that could still become one is held. `[<` followed
    // by anything else is typing.
    const head = this.held.indexOf('[<')
    if (head === 0) {
      const line = this.held.indexOf('\u001b')
      const candidate = line === -1 ? this.held : this.held.slice(0, line)
      if (ORPHAN_HEAD.test(candidate)) return undefined
    }
    const code = this.held.codePointAt(0) ?? 0
    return this.cut(code > 0xffff ? 2 : 1)
  }

  private cut(length: number): string {
    const piece = this.held.slice(0, length)
    this.held = this.held.slice(length)
    return piece
  }
}
