/**
 * Terminal color helpers and pi-tui theme objects.
 *
 * Only ANSI color/styling lives here; cursor movement and rendering are owned
 * entirely by pi-tui. Selected/current text uses foreground highlight, never a
 * background block (product UI rule). Two full-width background panels are not
 * selection state and are therefore allowed: an archived user message, which is
 * message content drawn like Claude Code's transcript rows, and the status band,
 * which is the frame's own bottom row rather than any column's content.
 *
 * @module hulala-cli/tui/view/theme
 */
import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui'
import { HIGHLIGHT_INK } from '@hulala/editor-home'

export interface ThemeSet {
  editor: EditorTheme
  selectList: SelectListTheme
  markdown: MarkdownTheme
}

function wrap(open: string, close: string) {
  return (text: string): string => `${open}${text}${close}`
}

/**
 * Brand ink: the pinwheel fill from `apps/website/public/logo-mark.svg`, which
 * is a fixed value rather than a theme token — the mark keeps this colour in
 * light and dark alike.
 */
const BRAND_RGB = [0x91, 0x80, 0x72] as const

/** Current-location ink, shared with the file tree in the editor column. */
const HIGHLIGHT_RGB = parseRgb(HIGHLIGHT_INK)

/**
 * Archived user message panel. A fixed dark chip with its own foreground, so
 * the block keeps the same contrast on light and dark terminals; the arrow is
 * muted like Claude Code's, the message body stays near-white.
 */
const USER_PANEL_BG = [0x37, 0x37, 0x37] as const
const USER_PANEL_TEXT = [0xe8, 0xe8, 0xe8] as const
const USER_PANEL_ARROW = [0x9a, 0x9a, 0x9a] as const

/**
 * Status band: the frame's bottom row, a step lighter than the page.
 *
 * The band is the reason the frame needs no bottom rule: a full-width row that
 * is visibly its own surface separates the footer from the columns without
 * drawing a horizontal line that the column dividers would meet. One ink carries
 * every slot — hint, readings, model — a step below the page's foreground so the
 * footer stays legible without competing with the conversation above it.
 */
const BAND_BG = [0x34, 0x3a, 0x44] as const
const BAND_TEXT = [0xa8, 0xad, 0xb7] as const

/**
 * Column divider ink: one step fainter than the composer's rules.
 *
 * A divider is a 1/8-cell block, so how thin it is belongs to the terminal and
 * the font; the one weight the client owns is contrast. Sitting a step below
 * `dim` keeps the split readable without letting it compete with the input box,
 * which is the line the eye should find first.
 */
const SEPARATOR_RGB = [0x5c, 0x63, 0x70] as const


const RESET = '\u001b[0m'

function supportsTrueColor(): boolean {
  const colorterm = process.env.COLORTERM
  return colorterm === 'truecolor' || colorterm === '24bit'
}

/** Nearest xterm-256 index for an RGB triple (6x6x6 cube then the grey ramp). */
function nearest256([r, g, b]: readonly [number, number, number]): number {
  const levels = [0, 95, 135, 175, 215, 255]
  let best = 16
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < 216; index += 1) {
    const cr = levels[Math.floor(index / 36)]!
    const cg = levels[Math.floor(index / 6) % 6]!
    const cb = levels[index % 6]!
    const distance = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = 16 + index
    }
  }
  for (let step = 0; step < 24; step += 1) {
    const value = 8 + step * 10
    const distance = (value - r) ** 2 + (value - g) ** 2 + (value - b) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = 232 + step
    }
  }
  return best
}

/** Foreground sequence for an RGB triple: truecolor when advertised, else 256 colour. */
function fgOpen(rgb: readonly [number, number, number]): string {
  const [r, g, b] = rgb
  return supportsTrueColor() ? `\u001b[38;2;${r};${g};${b}m` : `\u001b[38;5;${nearest256(rgb)}m`
}

/** Background sequence for an RGB triple: truecolor when advertised, else 256 colour. */
function bgOpen(rgb: readonly [number, number, number]): string {
  const [r, g, b] = rgb
  return supportsTrueColor() ? `\u001b[48;2;${r};${g};${b}m` : `\u001b[48;5;${nearest256(rgb)}m`
}

/** Parse `#rrggbb` into an RGB triple. */
function parseRgb(value: string): readonly [number, number, number] {
  const text = value.replace('#', '')
  return [
    Number.parseInt(text.slice(0, 2), 16),
    Number.parseInt(text.slice(2, 4), 16),
    Number.parseInt(text.slice(4, 6), 16),
  ]
}

/** Share of the foreground mixed into an unfocused cursor block. */
const FAINT_CURSOR_MIX = 0.2

/**
 * Cursor block for a column that does not have focus: the focused cursor's
 * fill faded almost all the way into the background.
 *
 * A terminal cell has no alpha for its background, and Ghostty's SGR 2 (faint)
 * only dims the glyph inside an inverted block, not the block itself. The look
 * is therefore a blend of the foreground into the background, with the character
 * cut out in the background colour.
 *
 * The mix is deliberately low (one fifth of the way to the foreground): a
 * half-opacity block still reads as a live cursor, and the first thing a user
 * asks when two columns are on screen is which one has the keyboard. At this
 * ratio the block is a ghost of the focused cursor — visible enough to find the
 * caret, far too faint to be mistaken for the active one.
 * @param color - whether colour output is enabled at all.
 * @param background - theme background, `#rrggbb`.
 * @param foreground - theme foreground, `#rrggbb`.
 * @returns the SGR sequence, or `''` when colour is disabled.
 */
export function faintCursorSgr(color: boolean, background: string, foreground: string): string {
  if (!color) return ''
  const bg = parseRgb(background)
  const fg = parseRgb(foreground)
  const mix = (index: 0 | 1 | 2): number => Math.round(bg[index] + (fg[index] - bg[index]) * FAINT_CURSOR_MIX)
  const fill: [number, number, number] = [mix(0), mix(1), mix(2)]
  return `${bgOpen(fill)}${fgOpen(bg)}`
}

/**
 * Styles rebuilt per frame by every row that draws is a per-frame cost with no
 * content: the same closures, the same escape sequences, once per row. One set
 * per terminal capability is all a window ever needs.
 */
const stylesByCapability = new Map<string, ReturnType<typeof createStyles>>()

/**
 * The style set for a terminal, built once per colour capability.
 * @param color - whether colour output is enabled at all.
 * @returns the shared style set.
 */
function buildStyles(color: boolean): ReturnType<typeof createStyles> {
  const key = color ? (supportsTrueColor() ? 'color-24bit' : 'color-256') : 'plain'
  const existing = stylesByCapability.get(key)
  if (existing !== undefined) return existing
  const styles = createStyles(color)
  stylesByCapability.set(key, styles)
  return styles
}

function createStyles(color: boolean): {
  dim: (text: string) => string
  accent: (text: string) => string
  highlight: (text: string) => string
  brand: (text: string) => string
  band: (text: string) => string
  separator: (text: string) => string
  userPanel: (text: string) => string
  userArrow: (text: string) => string
  error: (text: string) => string
  warn: (text: string) => string
  ok: (text: string) => string
  bold: (text: string) => string
  italic: (text: string) => string
  strike: (text: string) => string
  underline: (text: string) => string
  code: (text: string) => string
  /** pi's `mdCode` ink: inline code is violet there, a heading yellow. */
  violet: (text: string) => string
  /** Colour one syntax token of a code block, by the name its tokenizer gave it. */
  syntax: (type: string, text: string) => string
} {
  if (!color) {
    const identity = (text: string): string => text
    return { dim: identity, accent: identity, highlight: identity, brand: identity, band: identity, separator: identity, userPanel: identity, userArrow: identity, error: identity, warn: identity, ok: identity, bold: identity, italic: identity, strike: identity, underline: identity, code: identity, violet: identity, syntax: (_type: string, text: string) => text }
  }
  // A panel carries its own background and foreground. Inner styles reset both,
  // so re-open the panel after every nested reset to keep the row continuous to
  // the terminal edge.
  const panel = (open: string) => (text: string): string =>
    `${open}${text.split(RESET).join(`${RESET}${open}`)}${RESET}`
  return {
    dim: wrap('\u001b[2m', RESET),
    brand: wrap(fgOpen(BRAND_RGB), RESET),
    highlight: wrap(fgOpen(HIGHLIGHT_RGB), RESET),
    accent: wrap('\u001b[36m', RESET),
    band: panel(`${bgOpen(BAND_BG)}${fgOpen(BAND_TEXT)}`),
    separator: wrap(fgOpen(SEPARATOR_RGB), RESET),
    userPanel: panel(`${bgOpen(USER_PANEL_BG)}${fgOpen(USER_PANEL_TEXT)}`),
    userArrow: wrap(fgOpen(USER_PANEL_ARROW), RESET),
    error: wrap('\u001b[31m', RESET),
    warn: wrap('\u001b[33m', RESET),
    ok: wrap('\u001b[32m', RESET),
    bold: wrap('\u001b[1m', RESET),
    italic: wrap('\u001b[3m', RESET),
    strike: wrap('\u001b[9m', RESET),
    underline: wrap('\u001b[4m', RESET),
    code: wrap('\u001b[33m', RESET),
    violet: wrap('\u001b[35m', RESET),
    syntax: (type: string, text: string): string => SYNTAX[type]?.(text) ?? text,
  }
}

/**
 * Code token inks, by the token type the highlighter reports.
 *
 * One hue per family, in the four bits a 16-colour terminal is guaranteed to
 * have: a keyword is magenta, a string green, a number yellow, a comment faint,
 * a type blue, a function cyan. Everything else keeps the terminal's own text
 * colour, so a block of code stays readable in a monochrome terminal and the
 * palette never becomes a second theme.
 */
const SYNTAX: Readonly<Record<string, (text: string) => string>> = {
  kwd: wrap('\u001b[35m', RESET),
  func: wrap('\u001b[36m', RESET),
  str: wrap('\u001b[32m', RESET),
  insert: wrap('\u001b[32m', RESET),
  num: wrap('\u001b[33m', RESET),
  bool: wrap('\u001b[33m', RESET),
  type: wrap('\u001b[34m', RESET),
  class: wrap('\u001b[34m', RESET),
  cmnt: wrap('\u001b[2m', RESET),
  esc: wrap('\u001b[36m', RESET),
  err: wrap('\u001b[31m', RESET),
  deleted: wrap('\u001b[31m', RESET),
  section: wrap('\u001b[1m', RESET),
}

/**
 * A code block's two fence lines, drawn as a frame.
 *
 * pi-tui prints the fence text through this function, which is why a theme can
 * decide what a code block's edges look like: the top line becomes a corner with
 * the language's name behind it, the bottom one the matching corner, so a block
 * reads as a block without a literal ``` in the transcript.
 *
 * The opening line of a fence that names no language arrives as the same three
 * characters as the closing one, so the pair is tracked rather than guessed:
 * every code block emits exactly two border lines, the opening one first.
 * @param s - the style set to draw with.
 * @returns the fence line the renderer prints.
 */
function codeFrame(s: ReturnType<typeof createStyles>): (text: string) => string {
  let opening = true
  return (text: string): string => {
    if (!opening) {
      opening = true
      return s.dim('└─')
    }
    opening = false
    const language = text.slice(3).trim()
    return language === '' ? s.dim('┌─') : `${s.dim('┌─')} ${s.code(language)}`
  }
}

/** Build the full theme set for a terminal (color on/off). */
export function buildTheme(color: boolean): ThemeSet {
  const s = buildStyles(color)
  const selectList: SelectListTheme = {
    selectedPrefix: s.accent,
    selectedText: s.accent,
    description: s.dim,
    scrollInfo: s.dim,
    noMatch: s.dim,
  }
  const editor: EditorTheme = {
    borderColor: s.dim,
    selectList,
  }
  const markdown: MarkdownTheme = {
    // pi paints a heading and leaves its weight alone; the ink is the yellow it
    // gives inline code, so a heading reads as one by being alone on its line.
    heading: s.code,
    link: s.accent,
    linkUrl: s.dim,
    code: s.violet,
    codeBlock: (text: string) => text,
    codeBlockBorder: codeFrame(s),
    quote: s.dim,
    quoteBorder: s.dim,
    hr: s.dim,
    listBullet: s.accent,
    bold: s.bold,
    italic: s.italic,
    strikethrough: s.strike,
    underline: s.underline,
  }
  return { editor, selectList, markdown }
}

export { buildStyles }
