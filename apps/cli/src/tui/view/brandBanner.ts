/**
 * The home-screen banner: the pinwheel beside the version and the key hints.
 *
 * This is the real logo, not character art. pi-tui's `Image` component detects
 * the terminal's graphics protocol (kitty — Ghostty, kitty, WezTerm — or iTerm2),
 * encodes the bitmap and emits it as a line the renderer tracks, which keeps it
 * alive across repaints and lets the terminal free the pixels afterwards.
 *
 * It is laid out as an `HStack` rather than by prefixing spaces onto the image
 * line: an image line is a single escape sequence the renderer tracks by
 * position, and padding it by hand puts every row below it at risk. Letting the
 * layout engine place the image keeps the escape untouched and the text beside
 * it, the way pi's startup header does it.
 *
 * The mark does not move. A terminal image is a layer that outlives the frame it
 * was painted in, and a spinning wheel beside text the user is reading is noise.
 *
 * When the terminal has no image protocol there is nothing to show: no ASCII
 * fallback, no half-block approximation. A fresh session simply starts empty.
 *
 * @module hulala-cli/tui/view/brandBanner
 */
import { HStack, Image, Text, allocateImageId, getCapabilities } from '@earendil-works/pi-tui'
import { LOGO_PNG_BASE64 } from '../../brand/logoPng.js'
import { VERSION } from '../../constants.js'
import { activeLanguage, t } from '../i18n/index.js'
import { buildStyles } from './theme.js'

/**
 * Cells the mark claims. A cell is twice as tall as it is wide and the mark is
 * square, so eight columns also means four rows — enough for the blades and the
 * hub to read, and small enough to sit beside two lines of text.
 */
const LOGO_CELLS = 8

/**
 * One kitty image id for the life of the process.
 *
 * The banner is re-rendered whenever the width changes, and a fresh `Image` would
 * allocate a fresh id each time: the old placement stays on screen and the
 * shutdown delete only knows about the newest one. A single id makes every
 * re-render *replace* the mark, so one delete removes the only copy.
 */
const imageId = allocateImageId()

interface Built {
  width: number
  language: string
  lines: string[]
  imageId: number | undefined
}

let built: Built | undefined

/** The banner for the empty home screen, or none when images are unavailable. */
export function brandBannerLines(width: number): string[] {
  if (getCapabilities().images === null) return []
  const language = activeLanguage()
  if (built !== undefined && built.width === width && built.language === language) return built.lines

  const styles = buildStyles(true)
  const image = new Image(
    LOGO_PNG_BASE64,
    'image/png',
    { fallbackColor: styles.dim },
    { maxWidthCells: LOGO_CELLS, imageId, filename: 'hulala pinwheel' },
  )
  const keys = (key: string) => styles.dim(key)
  // The full hint set needs the room beside the mark; below that it wraps into a
  // paragraph, so narrow terminals get the keys that matter.
  const hints = width >= 96
    ? [
        `${keys('esc')} ${t('banner.interrupt')} · ${keys('ctrl+c')} ${t('banner.clearExit')} · ${keys('/')} ${t('banner.commands')} · ${keys('!')} ${t('banner.bash')}`,
        `${keys('ctrl+g')} ${t('banner.sessions')} · ${keys('ctrl+t')} ${t('banner.terminal')} · ${keys('ctrl+f')} ${t('banner.editor')}`,
        `${keys('ctrl+d')} ${t('banner.chat')} · ${keys('ctrl+o')} ${t('banner.expand')} · ${keys('/help')} ${t('banner.more')}`,
      ]
    : [`${keys('esc')} ${t('banner.interrupt')} · ${keys('ctrl+c')} ${t('banner.clearExit')} · ${keys('ctrl+t')} ${t('banner.terminal')} · ${keys('/')} ${t('banner.commands')}`]
  const text = new Text([`${styles.bold('hulala')} ${styles.dim(`v${VERSION}`)}`, ...hints].join('\n'))
  // The image gets a fixed column and the hints take the rest, so the text wraps
  // on a narrow terminal instead of pushing the mark off the row.
  const banner = new HStack([
    { component: image, basis: LOGO_CELLS + 2, shrink: 0 },
    { component: text, grow: 1 },
  ])
  const lines = banner.render(width)
  built = { width, language, lines, imageId }
  return lines
}

/** Whether the banner is currently on screen, for cleanup at shutdown. */
export function brandBannerImageId(): number | undefined {
  return built?.imageId
}
