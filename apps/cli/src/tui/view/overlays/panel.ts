/**
 * Bordered panel lines shared by the modal overlays.
 *
 * Pure string layout over pi-tui's width helpers; no terminal writes.
 *
 * @module hulala-cli/tui/view/overlays/panel
 */
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

function clip(text: string, width: number): string {
  const clipped = truncateToWidth(text, width)
  return clipped
}

function pad(text: string, width: number): string {
  const missing = width - visibleWidth(text)
  return missing > 0 ? text + ' '.repeat(missing) : text
}

/** Compose a titled, bordered panel. */
export function panel(width: number, title: string, body: readonly string[], footer: readonly string[] = []): string[] {
  // `edge` is what sits between the two corners; `inner` is what sits between
  // `│ ` and ` │`. They differ by two because every body row spends one cell on
  // each side for that padding, and a row two cells wider than its own border
  // would be clipped by the compositor and lose its right edge.
  const edge = Math.max(2, width - 2)
  const inner = Math.max(2, width - 4)
  const lines: string[] = []
  if (title === '') {
    lines.push(`┌${'─'.repeat(edge)}┐`)
  } else {
    const clippedTitle = clip(` ${title} `, edge)
    const fill = Math.max(0, edge - visibleWidth(clippedTitle))
    lines.push(`┌${clippedTitle}${'─'.repeat(fill)}┐`)
  }
  for (const line of body) lines.push(`│ ${pad(clip(line, inner), inner)} │`)
  for (const line of footer) lines.push(`│ ${pad(clip(line, inner), inner)} │`)
  lines.push(`└${'─'.repeat(edge)}┘`)
  return lines
}
