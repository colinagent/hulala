/**
 * Editor colours derived from the terminal's own palette.
 *
 * The client paints no background of its own: the conversation is drawn in the
 * terminal's default colours, so "the editor matches Hulala" can only mean "the
 * editor matches the terminal". Neovim therefore gets a generated theme instead
 * of a bundled colorscheme: the UI asks the terminal for its default foreground,
 * background and ANSI palette (OSC 10/11/4), and this module maps those into the
 * highlight groups the editor needs.
 *
 * The result is that opening the editor column does not change the background
 * colour across the split, and switching the terminal theme restyles both halves
 * at once. Terminals that do not answer the query fall back to
 * {@link FALLBACK_THEME}.
 *
 * @module @hulala/editor-home/editorTheme
 */
import type { RgbColor, TerminalColors } from '@earendil-works/pi-tui'

/** Highlight inputs the generated Neovim config consumes. */
export interface EditorTheme {
  readonly background: string
  readonly foreground: string
  readonly comment: string
  readonly linenr: string
  readonly cursorline: string
  readonly visual: string
  readonly search: string
  readonly border: string
  readonly pmenu: string
  readonly pmenuSelected: string
  readonly string: string
  readonly number: string
  readonly constant: string
  readonly keyword: string
  readonly func: string
  readonly type: string
  readonly special: string
  readonly error: string
  readonly warn: string
  readonly info: string
  readonly hint: string
  readonly added: string
  readonly changed: string
  readonly removed: string
  readonly title: string
  readonly directory: string
  /** Current-location ink: the open file in the tree, the row under the keyboard. */
  readonly highlight: string
}

/**
 * Current-location ink: the brand hue lifted for legibility on a dark terminal.
 *
 * Selection and current location are text, never a filled row, so the colour has
 * to carry on its own against the default background — the brand ink itself is
 * too muted for that at a 20-column rail. It is deliberately not derived from the
 * terminal palette: the rail and the file tree are the same signal in the same
 * client, so they keep the same ink on every machine.
 */
export const HIGHLIGHT_INK = '#d8aa78'

/** Neutral dark palette used when the terminal does not report its colours. */
export const FALLBACK_THEME: EditorTheme = {
  background: '#1b1d23',
  foreground: '#c8d3f5',
  comment: '#636da6',
  linenr: '#545c7e',
  cursorline: '#24273a',
  visual: '#2e3c64',
  search: '#3d59a1',
  border: '#2f334d',
  pmenu: '#24273a',
  pmenuSelected: '#2f334d',
  string: '#c3e88d',
  number: '#ff9e64',
  constant: '#ff9e64',
  keyword: '#c099ff',
  func: '#82aaff',
  type: '#ffc777',
  special: '#86e1fc',
  error: '#ff757f',
  warn: '#ffc777',
  info: '#82aaff',
  hint: '#c3e88d',
  added: '#c3e88d',
  changed: '#ffc777',
  removed: '#ff757f',
  title: '#82aaff',
  directory: '#82aaff',
  highlight: HIGHLIGHT_INK,
}

/** ANSI palette indices used for syntax accents. */
const ANSI = { red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, cyan: 6 } as const

function hex({ r, g, b }: RgbColor): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

function parseHex(value: string): RgbColor {
  const text = value.replace('#', '')
  return {
    r: Number.parseInt(text.slice(0, 2), 16),
    g: Number.parseInt(text.slice(2, 4), 16),
    b: Number.parseInt(text.slice(4, 6), 16),
  }
}

/** Blend `ratio` of `toward` into `base`. */
function mix(base: string, toward: string, ratio: number): string {
  const a = parseHex(base)
  const b = parseHex(toward)
  const t = Math.max(0, Math.min(1, ratio))
  return hex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  })
}

/**
 * Build the editor theme from what the terminal reported.
 * @param colors - terminal colours, or undefined when the query timed out.
 * @returns highlight colours for the generated config.
 */
export function editorThemeFromTerminal(colors: TerminalColors | undefined): EditorTheme {
  const background = colors?.background === undefined ? undefined : hex(colors.background)
  const foreground = colors?.foreground === undefined ? undefined : hex(colors.foreground)
  if (background === undefined || foreground === undefined) return FALLBACK_THEME
  const palette = colors?.palette
  const accent = (index: number, fallback: string): string => {
    const color = palette?.[index]
    return color === undefined ? fallback : hex(color)
  }
  const string = accent(ANSI.green, FALLBACK_THEME.string)
  const number = accent(ANSI.yellow, FALLBACK_THEME.number)
  const blue = accent(ANSI.blue, FALLBACK_THEME.func)
  const magenta = accent(ANSI.magenta, FALLBACK_THEME.keyword)
  const cyan = accent(ANSI.cyan, FALLBACK_THEME.special)
  const red = accent(ANSI.red, FALLBACK_THEME.error)
  return {
    background,
    foreground,
    comment: mix(foreground, background, 0.55),
    linenr: mix(foreground, background, 0.62),
    cursorline: mix(background, foreground, 0.06),
    visual: mix(background, blue, 0.28),
    search: mix(background, number, 0.35),
    border: mix(background, foreground, 0.18),
    pmenu: mix(background, foreground, 0.08),
    pmenuSelected: mix(background, foreground, 0.18),
    string,
    number,
    constant: number,
    keyword: magenta,
    func: blue,
    type: number,
    special: cyan,
    error: red,
    warn: number,
    info: blue,
    hint: string,
    added: string,
    changed: number,
    removed: red,
    title: blue,
    directory: blue,
    highlight: HIGHLIGHT_INK,
  }
}
