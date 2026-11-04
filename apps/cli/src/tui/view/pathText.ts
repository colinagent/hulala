/**
 * Path shortening helpers shared by the footer rows.
 *
 * @module hulala-cli/tui/view/pathText
 */
import { visibleWidth } from '@earendil-works/pi-tui'

export function shortenHome(path: string): string {
  const home = process.env.HOME
  if (home !== undefined && home !== '' && (path === home || path.startsWith(`${home}/`))) {
    return `~${path.slice(home.length)}`
  }
  return path
}

/** Keep the rightmost `maxWidth` columns of a string. */
function keepRight(text: string, maxWidth: number): string {
  if (visibleWidth(text) <= maxWidth) return text
  const segments = [...new Intl.Segmenter().segment(text)].reverse()
  let result = ''
  let width = 0
  for (const segment of segments) {
    const w = visibleWidth(segment.segment)
    if (width + w > maxWidth) break
    result = segment.segment + result
    width += w
  }
  return result
}

/** Shorten a path to fit, preferring the tail (`…/leaf`). */
export function shortenPath(path: string, maxWidth: number): string {
  const display = shortenHome(path)
  if (visibleWidth(display) <= maxWidth) return display
  const ellipsis = '…'
  const budget = Math.max(1, maxWidth - visibleWidth(ellipsis))
  return `${ellipsis}${keepRight(display, budget)}`
}

/** Keep the leftmost `maxWidth` columns and append an ellipsis. */
export function truncateLeftText(text: string, maxWidth: number): string {
  if (visibleWidth(text) <= maxWidth) return text
  const ellipsis = '…'
  const budget = Math.max(0, maxWidth - visibleWidth(ellipsis))
  let result = ''
  let width = 0
  for (const segment of new Intl.Segmenter().segment(text)) {
    const w = visibleWidth(segment.segment)
    if (width + w > budget) break
    result += segment.segment
    width += w
  }
  return result + ellipsis
}

/**
 * Fit a path into a narrow column, cutting between segments.
 *
 * The Session rail is 18–24 columns wide, so a real working directory never
 * fits. Cutting inside a segment (`…ote/projects/hulala`) makes a directory read
 * like a typo, so this drops whole leading segments and marks the cut with
 * `…/`: `…/projects/hulala`, then `…/hulala`. The tail is what says where the
 * Session lives, and `~/` stays where it was when the path is under home.
 *
 * When even one segment does not fit it is clipped from the right
 * (`hulala-worksp…`), because the beginning of a name identifies it.
 * @param path - absolute path to display.
 * @param width - columns available.
 * @returns a path no wider than `width`, cut only between segments when it can.
 */
export function fitPath(path: string, width: number): string {
  const display = shortenHome(path)
  if (width <= 0) return ''
  if (visibleWidth(display) <= width) return display
  const segments = display.split('/').filter(segment => segment !== '' && segment !== '.')
  if (segments.length === 0) return display.startsWith('/') ? '/' : display
  const prefix = display.startsWith('/') ? '…/' : '…/'
  for (let kept = segments.length - 1; kept >= 1; kept -= 1) {
    const candidate = `${prefix}${segments.slice(-kept).join('/')}`
    if (visibleWidth(candidate) <= width) return candidate
  }
  const leaf = segments.at(-1) ?? display
  return truncateLeftText(leaf, width)
}

export function padEnd(text: string, width: number): string {
  const missing = width - visibleWidth(text)
  return missing > 0 ? text + ' '.repeat(missing) : text
}
