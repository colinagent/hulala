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
import { HIGHLIGHT_INK } from '../editor/editorTheme.js'

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

function buildStyles(color: boolean): {
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
} {
  if (!color) {
    const identity = (text: string): string => text
    return { dim: identity, accent: identity, highlight: identity, brand: identity, band: identity, separator: identity, userPanel: identity, userArrow: identity, error: identity, warn: identity, ok: identity, bold: identity, italic: identity, strike: identity, underline: identity, code: identity }
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
    heading: s.bold,
    link: s.accent,
    linkUrl: s.dim,
    code: s.code,
    codeBlock: (text: string) => text,
    codeBlockBorder: s.dim,
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
