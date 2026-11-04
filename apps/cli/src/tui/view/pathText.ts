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

export function padEnd(text: string, width: number): string {
  const missing = width - visibleWidth(text)
  return missing > 0 ? text + ' '.repeat(missing) : text
}
