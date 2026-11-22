/**
 * Terminal color helpers and pi-tui theme objects.
 *
 * Only ANSI color/styling lives here; cursor movement and rendering are owned
 * entirely by pi-tui. Selected/current text uses foreground highlight, never a
 * background block (product UI rule). Full-width background panels are not
 * selection state and are therefore allowed: an archived user message, which is
 * message content drawn as a palette band (see {@link placeUserSurface}); the
 * status band, which is the frame's own bottom row rather than any column's
 * content; and a tool card, which is a *surface* a call's body is printed on. A
 * card leans the way its call went, by a tint thin enough to be felt rather than read: the ink
 * a card carries is one set for every tone, and the marker and the `exit 5`
 * capsule stay the loudest thing on the row.
 *
 * @module hulala-cli/tui/view/theme
 */
import { colorToOkhsl, okhslColor, parseColor } from '@earendil-works/pi-tui'
import type { EditorTheme, MarkdownTheme, SelectListTheme, TerminalColors } from '@earendil-works/pi-tui'
import { FALLBACK_THEME, HIGHLIGHT_INK } from '@hulala/editor-home'

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
 * Archived user message panel: the prompt's own turn, as a band across the
 * transcript.
 *
 * The band and its ink are the editor's *second* heading, exactly: `nvimConfig`
 * gives `##` the palette's yellow as its hue and tints the page a tenth of the
 * way towards it ({@link USER_PANEL_TINT}), and it draws the heading text in that
 * same yellow, undimmed. The prompt gets the same band and the same ink from the
 * same page and the same palette slot ({@link placeUserSurface}), so a prompt in
 * the conversation and a `##` heading in the editor column are one colour rather
 * than two that happen to match; the arrow takes the heading delimiter's fade
 * back into the page ({@link USER_PANEL_ARROW_FADE}).
 *
 * The band is only a cast on the page, so the prompt reads as the page warmed
 * towards the heading rather than as a chip dropped on it. Where that cast cannot
 * carry the heading's ink — a light page whose palette yellow is pale — the ink is
 * deepened just enough to clear a floor ({@link USER_PANEL_CONTRAST}): a heading
 * may be quiet for one line, the operator's own prompt may not.
 *
 * A terminal that reports nothing is not given a second chip: the same
 * derivation runs on the editor's fallback theme, so the two halves of the split
 * stay one colour even then.
 */
/** Share of the palette's yellow mixed into the page: `nvimConfig`'s `BAND_TINT[2]`. */
const USER_PANEL_TINT = 0.1
/** How far the arrow fades from the heading ink back into the page: the heading delimiters' blend. */
const USER_PANEL_ARROW_FADE = 0.45
/** Contrast the prompt's ink must clear against its band: the card bodies' floor. */
const USER_PANEL_CONTRAST = 4.5

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
 * Tool card: the surface every tool call and step body sits on.
 *
 * The card is tinted by the call's own state, the way pi's tool boxes are — a
 * settled success leans green, a failure leans red, a running or stopped call
 * leans sand — but only as far as a suggestion. pi paints those boxes at half
 * saturation in dark, which turns a column of steps into a row of coloured
 * blocks; here the tint is a tenth of that, on a surface a fraction lighter, so
 * the state is *felt* before it is read and the text stays what the eye lands on.
 *
 * "A step above the page" cannot be a fixed value: a slab dark enough for a
 * near-black terminal sits *below* the page on Nord or One Dark, and the card
 * disappears into it. The surfaces are therefore placed from the background the
 * terminal reports (OSC 11) — see {@link setTerminalPage} — in OKHSL, the
 * perceptual space the palette is written in: the page's lightness plus one small
 * step, in the tint's own hue. A terminal that reports no page is given the
 * client's footer slate as one, and a light page — where a dark chip is what
 * contrasts — gets surfaces derived the same way from it, so no card anywhere is
 * a hand-picked literal.
 */
/** Diff additions and removals, drawn on the surface. */
const CARD_OK = [0x9f, 0xc0, 0x9a] as const
const CARD_ERROR = [0xe0, 0x79, 0x6a] as const

/** An sRGB triple, 0-255 per channel. */
type Rgb = readonly [number, number, number]

/** The tones a card is drawn in: the call's state, as a tint on the surface. */
export type CardTone = 'neutral' | 'ok' | 'error' | 'warn'

/** The three inks an archived prompt is drawn with: its band, its text, its arrow. */
interface UserSurface {
  readonly background: Rgb
  readonly text: Rgb
  readonly arrow: Rgb
}

/** The three inks one card draws its surface and its neutral text with. */
interface CardSurface {
  readonly background: Rgb
  readonly text: Rgb
  readonly body: Rgb
}

/** One surface per tone. */
type CardSurfaces = Readonly<Record<CardTone, CardSurface>>

/**
 * How far above the page a card sits, in OKHSL lightness.
 *
 * OKHSL is where the palette is defined and where pi places its own surfaces: a
 * step of lightness looks the same size on any page, so one number carries every
 * theme. This is the smallest step that still reads as a slab once the tint is on
 * it — the card is meant to be found, not to compete with the column above it.
 */
const CARD_STEP = 0.09
/**
 * Ceiling for a card's OKHSL lightness, and the line between a page the card is
 * placed on and a page it cannot sit above.
 *
 * Past this the slab stops being a surface and starts competing with the text, so
 * a light page gets the fixed chip instead.
 */
const CARD_MAX_LIGHTNESS = 0.34
/**
 * Hue and saturation of each tone.
 *
 * The neutrals take the client's own highlight sand, so a running or stopped call
 * sits in the palette the rest of the client already uses; the two verdicts take
 * pi's hues for success and failure, carried at a fifth of pi's saturation. The
 * same lightness applies to all four, so a column of cards is one weight and only
 * the cast changes.
 */
const CARD_TINTS: Readonly<Record<CardTone, { hue: number; saturation: number }>> = {
  neutral: { hue: colorToOkhsl(parseColor(HIGHLIGHT_INK)).h, saturation: 0.05 },
  ok: { hue: 158, saturation: 0.07 },
  error: { hue: 19, saturation: 0.09 },
  warn: { hue: 40, saturation: 0.08 },
}
/**
 * The page assumed when the terminal reports none: the client's own footer slate.
 *
 * It is a colour the frame already draws, at the foot of every column, so a card
 * derived from it belongs to the same palette as the band above it.
 */
const ASSUMED_PAGE: Rgb = BAND_BG
/** The text ink for that assumed page: the highlight sand lifted toward white. */
const ASSUMED_TEXT: Rgb = mixRgb(HIGHLIGHT_RGB, [0xff, 0xff, 0xff], 0.6)
/** Contrast a card's body ink has to clear against the card surface. */
const CARD_BODY_CONTRAST = 4.5
/** Contrast a card's accent inks must clear: the `+`/`-` rows and the exit capsule. */
const CARD_ACCENT_CONTRAST = 3.5

/**
 * The cards for a page the terminal did not describe, or a page too bright to sit
 * under: derived from the client's own slate, so they are the same family as the
 * frame's band rather than literals of their own.
 */
const FIXED_CARDS: CardSurfaces = cardsOn(ASSUMED_PAGE, ASSUMED_TEXT)

/**
 * The band an archived prompt is drawn on.
 *
 * The editor's `HulalaHeadingBand2`, carried to the conversation: the page moved
 * `USER_PANEL_TINT` of the way towards the palette's yellow, which is what
 * `nvimConfig` gives level 2 — `BAND_TINT[2]`, with `HUE_ORDER[2]` being the
 * editor's own `number` slot. Sharing the formula and the same fallback, rather
 * than a second pair of literals, is what keeps the two halves of the split from
 * drifting apart — including on a terminal that reports a page but no 16-colour
 * palette, where both halves fall back to the same ink.
 * @param page - the page's background, or undefined when it reported none.
 * @param yellow - the palette's yellow, or undefined when it reported none.
 * @returns the band's colour.
 */
function userBand(page: Rgb | undefined, yellow: Rgb | undefined): Rgb {
  return mixRgb(
    page ?? parseRgb(FALLBACK_THEME.background),
    yellow ?? parseRgb(FALLBACK_THEME.number),
    USER_PANEL_TINT,
  )
}

/**
 * The three inks an archived prompt is drawn with on one page.
 *
 * The text is the heading's own ink — the palette's yellow, undimmed, which is
 * `HulalaHeading2`'s `fg` — and the arrow is that ink blended towards the page,
 * which is the `markdownH2Delimiter` rule. Neither is derived from the page's
 * foreground: the editor's heading does not use it either, and matching that is
 * the point.
 * @param page - the page's background, or undefined when it reported none.
 * @param yellow - the palette's yellow, or undefined when it reported none.
 * @returns the band, its text ink and the arrow's ink.
 */
function placeUserSurface(page: Rgb | undefined, yellow: Rgb | undefined): UserSurface {
  const pageBackground = page ?? parseRgb(FALLBACK_THEME.background)
  const heading = yellow ?? parseRgb(FALLBACK_THEME.number)
  const background = userBand(page, yellow)
  const text = readable(heading, background, USER_PANEL_CONTRAST)
  return { background, text, arrow: mixRgb(text, pageBackground, USER_PANEL_ARROW_FADE) }
}

/**
 * Relative luminance of an sRGB triple, per WCAG 2.1.
 * @param rgb - the colour.
 * @returns luminance in 0-1.
 */
function luminance([r, g, b]: Rgb): number {
  const channel = (value: number): number => {
    const s = value / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * Contrast ratio between two inks.
 * @param a - one colour.
 * @param b - the other.
 * @returns the ratio, 1-21.
 */
function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = luminance(a) >= luminance(b) ? [a, b] : [b, a]
  return (luminance(light) + 0.05) / (luminance(dark) + 0.05)
}

/**
 * Blend two inks.
 * @param base - the colour to start from.
 * @param toward - the colour to approach.
 * @param ratio - share of `toward`, 0-1.
 * @returns the blend.
 */
function mixRgb(base: Rgb, toward: Rgb, ratio: number): Rgb {
  const part = (index: 0 | 1 | 2): number => Math.round(base[index] + (toward[index] - base[index]) * ratio)
  return [part(0), part(1), part(2)]
}

/**
 * Read a reported colour as a triple.
 * @param color - one of the terminal's own colours.
 * @returns the same colour as an sRGB triple.
 */
function toRgb(color: { r: number; g: number; b: number }): Rgb {
  return [color.r, color.g, color.b]
}

/**
 * Whether two inks are the same triple.
 * @param a - one colour.
 * @param b - the other.
 * @returns true when every channel matches.
 */
function sameRgb(a: Rgb, b: Rgb): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

/**
 * Present a triple as the colour type pi-tui's conversions take.
 * @param rgb - the colour.
 * @returns the same colour as an sRGB value.
 */
function rgbColorOf([r, g, b]: Rgb): { kind: 'rgb'; r: number; g: number; b: number } {
  return { kind: 'rgb', r, g, b }
}

/**
 * The four card surfaces for one page.
 *
 * Each is the page's lightness, one step up, in its tone's hue at that tone's
 * thin saturation — the rule pi's palette follows for its surfaces, carried
 * lighter and much paler. The body ink is measured against the brightest of the
 * four, so every tone reads at the same contrast.
 * @param page - the page's background.
 * @param text - the text ink to measure the body against.
 * @returns the surfaces, one per tone.
 */
function cardsOn(page: Rgb, text: Rgb): CardSurfaces {
  const lightness = Math.min(CARD_MAX_LIGHTNESS, colorToOkhsl(rgbColorOf(page)).l + CARD_STEP)
  const surfaces = {} as Record<CardTone, Rgb>
  for (const tone of Object.keys(CARD_TINTS) as CardTone[]) {
    const tint = CARD_TINTS[tone]
    surfaces[tone] = toRgb(okhslColor(tint.hue, tint.saturation, lightness))
  }
  const brightest = Object.values(surfaces).reduce((a, b) => luminance(a) >= luminance(b) ? a : b)
  const body = bodyInk(brightest, text)
  const cards = {} as Record<CardTone, CardSurface>
  for (const tone of Object.keys(surfaces) as CardTone[]) cards[tone] = { background: surfaces[tone], text, body }
  return cards
}

/**
 * The card for a page the terminal reported.
 * @param page - the page's background and text ink.
 * @returns the surface to draw on, or the fixed chip when the page is light.
 */
function placeCards(page: { background: Rgb; foreground: Rgb } | undefined): CardSurfaces {
  // A page already at the ceiling has no room for a step above it: the fixed
  // chip (and a light page) is what contrasts there.
  if (page === undefined || colorToOkhsl(rgbColorOf(page.background)).l >= CARD_MAX_LIGHTNESS) return FIXED_CARDS
  return cardsOn(page.background, page.foreground)
}

/**
 * The quietest body ink that is still readable on a card.
 *
 * The card's body text is a step back from the page's own text ink, so a
 * command's output does not shout over the conversation. On a lifted surface the
 * fixed muted ink would sink below 4.5:1, so the step is measured instead of
 * guessed: the first blend of the surface toward the text ink that clears the
 * contrast floor wins.
 * @param surface - the card's background.
 * @param text - the card's title ink.
 * @returns the body ink.
 */
function bodyInk(surface: Rgb, text: Rgb): Rgb {
  for (let step = 40; step < 100; step += 2) {
    const ink = mixRgb(surface, text, step / 100)
    if (contrast(ink, surface) >= CARD_BODY_CONTRAST) return ink
  }
  return text
}

/**
 * Move an ink away from its surface until it clears a floor.
 *
 * The card accents are a fixed hue per family, picked against the fixed slab. On
 * a surface lifted for a brighter page the reds and cyans lose contrast first, so
 * each one is mixed toward white — the smallest lift that keeps its hue readable
 * — rather than replaced by a second palette. The archived prompt's band asks the
 * same question from either side: on a light page the heading's yellow has to be
 * deepened toward black instead, so the direction follows the surface.
 * @param ink - the ink's own colour.
 * @param surface - the surface it is drawn on.
 * @param floor - the contrast ratio the ink has to clear.
 * @returns the ink to draw.
 */
function readable(ink: Rgb, surface: Rgb, floor: number): Rgb {
  if (contrast(ink, surface) >= floor) return ink
  const away: Rgb = luminance(surface) < 0.5 ? [255, 255, 255] : [0, 0, 0]
  for (let step = 2; step <= 100; step += 2) {
    const moved = mixRgb(ink, away, step / 100)
    if (contrast(moved, surface) >= floor) return moved
  }
  return away
}

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

/** SGR 2: the one attribute a terminal cell has for "present, not active". */
const FAINT = '\u001b[2m'

/**
 * Fade a panel that is painted but does not hold the keyboard.
 *
 * A split screen needs one signal that says which column the next keystroke
 * lands in, and a terminal's own answer is faint: the content stays readable and
 * keeps every colour it was drawn with, but it no longer competes with the
 * column the user is in. This is the same thing Ghostty does to the unfocused
 * side of a split, expressed as an attribute rather than as a second palette —
 * the cards, chips and syntax inks the client already chose stay recognisable.
 *
 * The attribute is reset by every SGR reset a row contains, so it is re-opened
 * after each one; otherwise a single coloured token would leave the rest of its
 * row looking focused again.
 * @param lines - the panel's rendered rows.
 * @param color - whether styling is enabled at all.
 * @returns the rows to paint, faded when styling is available.
 */
export function faintLines(lines: readonly string[], color: boolean): string[] {
  if (!color) return [...lines]
  return lines.map(line => {
    const body = line.endsWith(RESET) ? line.slice(0, -RESET.length) : line
    return `${FAINT}${body.split(RESET).join(`${RESET}${FAINT}`)}${RESET}`
  })
}

/**
 * Styles rebuilt per frame by every row that draws is a per-frame cost with no
 * content: the same closures, the same escape sequences, once per row. One set
 * per terminal capability is all a window ever needs — and one more after the
 * terminal reports its page, hence the revision in the key.
 */
const stylesByCapability = new Map<string, ReturnType<typeof createStyles>>()

/** The cards' place against the page; `FIXED_CARDS` until the terminal reports one. */
let cardSurfaces: CardSurfaces = FIXED_CARDS
/** The archived prompt's band and ink; the fallback theme's until the terminal reports its page. */
let userSurface: UserSurface = placeUserSurface(undefined, undefined)
/** Bumped whenever the page changes, so the style cache rebuilds once. */
let surfaceRevision = 0

/**
 * Place the cards against the page the terminal actually paints.
 *
 * A card is a surface, so "a step above the page" has to be measured from the
 * page — a fixed slab is below the page on a theme whose background is lighter
 * than it, and then a whole conversation of cards reads as one dark gap. The
 * client already asks the terminal for its default background and foreground
 * (OSC 11/10) so the editor column can match it; the cards are placed from the
 * same answer, one step of OKHSL lightness above that page and a thin tint per
 * tone, with the body ink measured against the result so no card costs the text
 * its contrast.
 *
 * A light page keeps the fixed chip: there "above the page" points the other
 * way, the chip already contrasts, and its inks are the ones tuned for it. A
 * terminal that does not answer keeps it too.
 *
 * The archived prompt is placed from the same answer, but as a *band* rather than
 * a slab: the editor's `##` heading, which is the page moved a tenth of the way
 * towards the palette's yellow and drawn in that yellow
 * ({@link placeUserSurface}).
 * @param colors - what the terminal reported, or undefined when it stayed quiet.
 */
export function setTerminalPage(colors: TerminalColors | undefined): void {
  const reported = colors?.background === undefined || colors?.foreground === undefined
    ? undefined
    : { background: toRgb(colors.background), foreground: toRgb(colors.foreground) }
  const nextCards = placeCards(reported)
  const reportedYellow = colors?.palette?.[3]
  const nextUser = placeUserSurface(
    reported?.background,
    reportedYellow === undefined ? undefined : toRgb(reportedYellow),
  )
  if (sameRgb(cardSurfaces.neutral.background, nextCards.neutral.background)
    && sameRgb(cardSurfaces.neutral.text, nextCards.neutral.text)
    && sameRgb(userSurface.background, nextUser.background)
    && sameRgb(userSurface.text, nextUser.text)) return
  cardSurfaces = nextCards
  userSurface = nextUser
  surfaceRevision += 1
  stylesByCapability.clear()
}

/**
 * The style set for a terminal, built once per colour capability and page.
 * @param color - whether colour output is enabled at all.
 * @returns the shared style set.
 */
function buildStyles(color: boolean): ReturnType<typeof createStyles> {
  const key = `${color ? (supportsTrueColor() ? 'color-24bit' : 'color-256') : 'plain'}/${surfaceRevision}`
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
  /**
   * The tool-card surface for one tone: fill the line to the frame width first.
   *
   * It carries its own foreground, and re-opens both after every nested reset,
   * so the slab stays continuous under coloured text.
   */
  card: (tone: CardTone, text: string) => string
  /** Body, arguments and counts on a card. */
  cardMuted: (text: string) => string
  cardOk: (text: string) => string
  cardError: (text: string) => string
  /** Colour one syntax token of a card body, by the name its tokenizer gave it. */
  cardSyntax: (type: string, text: string) => string
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
    return { dim: identity, accent: identity, highlight: identity, brand: identity, band: identity, separator: identity, userPanel: identity, userArrow: identity, error: identity, warn: identity, ok: identity, card: (_tone: CardTone, text: string) => text, cardMuted: identity, cardOk: identity, cardError: identity, bold: identity, italic: identity, strike: identity, underline: identity, code: identity, violet: identity, syntax: (_type: string, text: string) => text, cardSyntax: (_type: string, text: string) => text }
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
    userPanel: panel(`${bgOpen(userSurface.background)}${fgOpen(userSurface.text)}`),
    userArrow: wrap(fgOpen(userSurface.arrow), RESET),
    error: wrap('\u001b[31m', RESET),
    warn: wrap('\u001b[33m', RESET),
    ok: wrap('\u001b[32m', RESET),
    card: (tone: CardTone, text: string): string =>
      panel(`${bgOpen(cardSurfaces[tone].background)}${fgOpen(cardSurfaces[tone].text)}`)(text),
    cardMuted: wrap(fgOpen(cardSurfaces.neutral.body), RESET),
    cardOk: wrap(fgOpen(readable(CARD_OK, cardSurfaces.neutral.background, CARD_ACCENT_CONTRAST)), RESET),
    cardError: wrap(fgOpen(readable(CARD_ERROR, cardSurfaces.neutral.background, CARD_ACCENT_CONTRAST)), RESET),
    bold: wrap('\u001b[1m', RESET),
    italic: wrap('\u001b[3m', RESET),
    strike: wrap('\u001b[9m', RESET),
    underline: wrap('\u001b[4m', RESET),
    code: wrap('\u001b[33m', RESET),
    violet: wrap('\u001b[35m', RESET),
    syntax: (type: string, text: string): string => SYNTAX[type]?.(text) ?? text,
    cardSyntax: (type: string, text: string): string => CARD_SYNTAX[type]?.(text) ?? text,
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
 * The same token families on a card, at fixed values.
 *
 * The page's inks are the terminal's own sixteen colours, which are picked to
 * read against the terminal's background — not against this card. Reading a file
 * inside a card therefore needs its own set: the same one hue per family, chosen
 * to clear the card's contrast instead of the page's.
 */
const CARD_SYNTAX: Readonly<Record<string, (text: string) => string>> = {
  kwd: wrap(fgOpen([0xc5, 0x9a, 0xd8]), RESET),
  func: wrap(fgOpen([0x79, 0xb8, 0xc8]), RESET),
  str: wrap(fgOpen([0xa8, 0xc6, 0x92]), RESET),
  insert: wrap(fgOpen([0xa8, 0xc6, 0x92]), RESET),
  num: wrap(fgOpen([0xd8, 0xaa, 0x78]), RESET),
  bool: wrap(fgOpen([0xd8, 0xaa, 0x78]), RESET),
  type: wrap(fgOpen([0x8f, 0xb1, 0xe0]), RESET),
  class: wrap(fgOpen([0x8f, 0xb1, 0xe0]), RESET),
  cmnt: wrap(fgOpen([0x7d, 0x85, 0x90]), RESET),
  esc: wrap(fgOpen([0x79, 0xb8, 0xc8]), RESET),
  err: wrap(fgOpen([0xe0, 0x79, 0x6a]), RESET),
  deleted: wrap(fgOpen([0xe0, 0x79, 0x6a]), RESET),
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
