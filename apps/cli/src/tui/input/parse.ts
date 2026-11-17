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
 * - a report that lost more than its escape — the digit groups and terminator
 *   with nothing in front of them, which is what a terminal's short write or a
 *   truncated queue leaves behind;
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

/** The head of a report, whose tail has not arrived. */
const REPORT_HEAD = /^\u001b?\[<[\d;]*$/u

/** A whole cursor or function key without its escape byte: `[C`, `[3~`, `OA`. */
const ORPHAN_SEQUENCE = /^(?:\[[\d;]*[A-Za-z~]|O[A-Z])/u

/**
 * A report that lost its introducer too: `b;x;yM` or `x;yM`.
 *
 * A terminal writes a report with one `write`, and a pty whose input queue is
 * full takes only part of it: the bytes that did not fit are gone, so the next
 * read starts inside a report instead of in front of one. Losing the introducer
 * is the worst case, because the digits left behind are printable — typed into
 * a composer they read `60;39M65;…`, which is exactly how this shows up.
 *
 * At least one `;` is required. A field without a separator (`5M`, `2024M`) is
 * ordinary typing that happens to end in the terminator's letter, and the window
 * this is read in is short enough that a person can produce one right after a
 * click; two coordinate groups cannot be a key press.
 */
const DAMAGED_TAIL = /^\d{1,4}(?:;\d{1,4}){1,2}[Mm]/u

/**
 * A digit run that may still grow into one.
 *
 * The separator is required here even though the report it belongs to may have
 * lost it: a bare digit is what a person types, and holding it would delay real
 * text. Two groups are not a keystroke.
 */
const DAMAGED_TAIL_RUN = /^\d{1,4}(?:;\d{1,4}){1,2}$/u

/**
 * How long after a report the stream is still assumed to be report traffic.
 *
 * A damaged tail carries no timestamp of its own, so the parser needs to know
 * whether the bytes in hand belong to a burst of reports. The anchor is the last
 * report it delivered; that is the only moment the stream was known good.
 */
const DEFAULT_REPORT_RUN_MS = 1_000

/**
 * The default for how long after an Escape its stripped sequence can arrive.
 *
 * The adapter owns the clock and passes its window in; this is the value a
 * parser built without options uses (and the one the tests read as "the
 * production window"). The gap is the frame being busy, not the user pausing: an
 * arrow key's escape is read on its own when a read ends after it, and the rest
 * follows within the same burst of work.
 */
const DEFAULT_ORPHAN_WINDOW_MS = 1_000

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

/** Options a parser needs; the adapter supplies the clock and its window. */
export interface InputParserOptions {
  /** How long after a delivered Escape its stripped tail may still be rejoined. */
  readonly orphanWindowMs?: number
  /** How long after a delivered report its stripped tail is still report traffic. */
  readonly reportRunMs?: number
  /** Clock, injected so a test can move time without sleeping. */
  readonly now?: () => number
}

/**
 * The incremental parser.
 *
 * One instance per terminal. `push` is called with exactly the bytes a read
 * produced and returns every piece that is complete; whatever is left stays in
 * the buffer until the next read or until `drain` is called.
 */
export class InputParser {
  private held = ''
  private readonly orphanWindowMs: number
  private readonly now: () => number
  /** When a bare Escape was handed on (-1 = never), so an escape-less tail can follow. */
  private escapedAt = -1
  /** Fragments dropped because their escape had already been handed on. */
  private dropped: string[] = []
  /** When the last complete report was delivered (-1 = never). */
  private reportAt = -1
  /** When the last damaged tail was dropped (-1 = never). */
  private residueAt = -1
  /** The report-shaped fragments dropped instead of being typed. */
  private damaged: string[] = []
  private readonly reportRunMs: number

  /** The dropped fragments, for the adapter's trace; read and cleared. */
  takeDrops(): string[] {
    return this.dropped.splice(0)
  }

  /** The damaged report fragments that were dropped; read and cleared. */
  takeDamaged(): string[] {
    return this.damaged.splice(0)
  }

  constructor(options: InputParserOptions = {}) {
    this.orphanWindowMs = options.orphanWindowMs ?? DEFAULT_ORPHAN_WINDOW_MS
    this.reportRunMs = options.reportRunMs ?? DEFAULT_REPORT_RUN_MS
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Throw away everything held, and stop treating what follows as report traffic.
   *
   * The caller uses this when the terminal's state cannot be trusted any more —
   * a machine that slept, a connection that was rebuilt. Half a sequence means
   * nothing after an interruption like that, and handing it back as keys is the
   * bug this parser exists to prevent, so it is dropped rather than drained.
   */
  reset(): void {
    if (this.held !== '') this.damaged.push(this.held)
    this.held = ''
    this.escapedAt = -1
    this.reportAt = -1
    this.residueAt = -1
  }

  /** Bytes waiting for their remainder. */
  pending(): string {
    return this.held
  }

  /**
   * What kind of fragment is waiting, so the adapter can choose its window.
   *
   * A report is one gesture and may wait longer than a key sequence; a paste is
   * not ambiguous at all once its start marker arrived and must never be given
   * back as keys. This is the only place that answers what a held fragment is.
   * @returns the fragment's kind, or `none` when nothing is held.
   */
  pendingKind(): 'none' | 'paste' | 'report' | 'sequence' {
    if (this.held === '') return 'none'
    if (this.held.startsWith(PASTE_START)) return 'paste'
    if (REPORT_HEAD.test(this.held)) return 'report'
    // A digit run held after a damaged tail may still become one; it waits on
    // the report's clock and `drain` drops it instead of typing it.
    if (this.damagedRecently() && DAMAGED_TAIL_RUN.test(this.held)) return 'report'
    return 'sequence'
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
      this.dropDamaged()
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
    // A bracketed paste is not ambiguous: its start marker already said what it
    // is, and it ends only at the end marker. Handing back an unfinished paste as
    // keys would type its first lines plus `[200~` into whatever has the
    // keyboard — the exact bug this parser exists to prevent. If the tail never
    // comes, `MAX_HELD` is the bound.
    if (this.held.startsWith(PASTE_START)) return []
    const held = this.held
    this.held = ''
    if (held === '') return []
    // A damaged report is never typing, whatever clock it arrives on.
    if (this.damagedRecently() && (DAMAGED_TAIL.test(held) || DAMAGED_TAIL_RUN.test(held))) {
      this.damaged.push(held)
      this.residueAt = this.now()
      return []
    }
    if (held === '\u001b') {
      this.escapedAt = this.now()
      return ['\u001b']
    }
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
   * Drop a report that lost its introducer.
   *
   * `push` calls this before every piece, so a damaged tail is removed wherever
   * it starts — including the middle of a read, which is where a truncated queue
   * leaves it. Dropping rather than repairing is deliberate: a tail that kept
   * only its coordinates has no button left to report, and inventing one would
   * turn a broken stream into a gesture the user never made.
   */
  private dropDamaged(): void {
    for (;;) {
      if (!this.residue()) return
      const match = DAMAGED_TAIL.exec(this.held)
      if (match === null) return
      this.damaged.push(this.cut(match[0].length))
      const now = this.now()
      this.residueAt = now
      // Still report traffic: a burst that lost one introducer is likely to lose
      // the next one too, and the window follows the damage rather than the
      // last report so a long damaged run stays covered.
      this.reportAt = now
    }
  }

  /** Whether the bytes in hand belong to a burst of reports. */
  private residue(): boolean {
    return this.reportAt >= 0 && this.now() - this.reportAt <= this.reportRunMs
  }

  /**
   * Whether the stream is known to be damaged right now.
   *
   * The difference from {@link residue} is what it licenses. Being inside a
   * burst only says the bytes could be report traffic; having dropped one
   * already says the stream is broken, and only then is it worth holding a digit
   * run that might still become a report. A person typing digits right after a
   * click keeps their characters.
   */
  private damagedRecently(): boolean {
    return this.residueAt >= 0 && this.now() - this.residueAt <= this.reportRunMs
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
    // An arrow key whose escape byte was read on its own: `[C` is what is left of
    // `ESC [ C`, and typing it is the same bug as typing a mouse report. It is
    // only read this way right after an escape, because a person typing `[C`
    // produces two separate events, not one chunk.
    if (this.escapedAt >= 0 && this.now() - this.escapedAt < this.orphanWindowMs) {
      const orphan = ORPHAN_SEQUENCE.exec(this.held)
      if (orphan !== null) {
        this.escapedAt = -1
        return `\u001b${this.cut(orphan[0].length)}`
      }
    }
    // The same tail after the window has closed: its escape was already handed
    // on as the Escape key, so rejoining is impossible. It is never typing
    // either — `[C` in the composer or the shell is the same garbage as a mouse
    // report, and a person who really wants the two characters has a whole
    // second of ordinary text in between. Dropped, with the stale escape time
    // cleared so ordinary typing is not punished for it.
    if (this.escapedAt >= 0) {
      const stale = ORPHAN_SEQUENCE.exec(this.held)
      if (stale !== null) {
        this.dropped.push(this.cut(stale[0].length))
        this.escapedAt = -1
        return undefined
      }
    }
    // A report whose escape was lost: the tail is whole in one read, so it is
    // recognised at once and never becomes text. The escape is restored because
    // everything above this parser reads a report as one sequence.
    const orphan = ORPHAN_REPORT.exec(this.held)
    if (orphan !== null) {
      // A report read after its introducer was split off is still a report, and
      // a good one: it anchors the burst the damaged-tail window measures.
      this.reportAt = this.now()
      return `\u001b${this.cut(orphan[0].length)}`
    }
    if (ORPHAN_HEAD.test(this.held) && this.held.length < 24) return undefined
    // Once the stream has shown a damaged tail, a trailing digit run is more
    // likely the next one than typing: hold it for the report's window, where
    // `drain` drops it if the rest never comes.
    if (this.damagedRecently() && DAMAGED_TAIL_RUN.test(this.held)) return undefined
    return this.takeText()
  }

  /** A piece that begins with an escape. */
  private takeEscape(): string | undefined {
    const report = REPORT.exec(this.held)
    if (report !== null) {
      this.reportAt = this.now()
      return this.cut(report[0].length)
    }
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
