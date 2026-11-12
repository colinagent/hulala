/**
 * Folded-body previews: the last (or first) few wrapped lines of a text, plus
 * how many rows are hidden.
 *
 * A body that fits its budget is shown whole; a longer one keeps one end and
 * reports the rest. Two things make this cheap enough to run on every frame of
 * a stream:
 *
 * - only a bounded window of the text is wrapped, so the cost stops growing
 *   with a long thought or a `cat` of a large file;
 * - the hidden count is a scan of the text (source lines outside the window)
 *   plus the rows the window itself dropped, so no second wrap is needed.
 *
 * The budgets are visual lines, not source lines: one long line (minified
 * JSON) must not wrap across the whole screen.
 *
 * @module hulala-cli/tui/view/preview
 */
import { wrapTextWithAnsi } from '@earendil-works/pi-tui'

/** How much of a body a folded row wraps. */
export const PREVIEW_WINDOW = 1_200

/**
 * Move a slice boundary off a surrogate pair.
 *
 * A UTF-16 cut through an astral character (an emoji, a rare CJK ideograph)
 * leaves a lone surrogate that the terminal draws as a replacement glyph. The
 * window edge is arbitrary, so step back to the pair's start.
 * @param text - the text being cut.
 * @param at - the proposed cut, a character index.
 * @returns `at`, or one less when it lands on a low surrogate.
 */
function safeCut(text: string, at: number): number {
  return at > 0 && (text.charCodeAt(at) & 0xfc00) === 0xdc00 ? at - 1 : at
}

/** One body slice kept from an end, plus how many rows were not shown. */
export interface Preview {
  lines: string[]
  hidden: number
}

/**
 * Keep the last `budget` wrapped lines of a text.
 * @param text - the body to show the end of.
 * @param width - the wrapping width.
 * @param budget - how many visual lines to keep.
 * @returns the kept lines and how many rows are above them.
 */
export function tailPreview(text: string, width: number, budget: number): Preview {
  const body = text.replace(/^(?:[ \t]*\n)+/u, '').replace(/\s+$/u, '')
  const sliced = body.length > PREVIEW_WINDOW
  const visible = sliced ? body.slice(safeCut(body, body.length - PREVIEW_WINDOW)) : body
  const wrapped = wrapTextWithAnsi(visible, width)
  const lines = wrapped.slice(-budget)
  // The window may start mid-line; only the lines wholly above it are counted,
  // and the partial one is the window's own first row.
  const above = sliced ? Math.max(0, body.slice(0, body.length - visible.length).split('\n').length - 1) : 0
  return { lines, hidden: above + wrapped.length - lines.length }
}

/**
 * Keep the first `budget` wrapped lines of a text.
 * @param text - the body to show the start of.
 * @param width - the wrapping width.
 * @param budget - how many visual lines to keep.
 * @returns the kept lines and how many rows are below them.
 */
export function headPreview(text: string, width: number, budget: number): Preview {
  const body = text.replace(/^(?:[ \t]*\n)+/u, '')
  const sliced = body.length > PREVIEW_WINDOW
  const visible = sliced ? body.slice(0, safeCut(body, PREVIEW_WINDOW)) : body
  const wrapped = wrapTextWithAnsi(visible, width)
  const lines = wrapped.slice(0, budget)
  const below = sliced ? Math.max(0, body.slice(PREVIEW_WINDOW).split('\n').length - 1) : 0
  return { lines, hidden: below + wrapped.length - lines.length }
}
