/**
 * Glyph geometry shared by every step row.
 *
 * The web transcript gives each row a 16px leading icon box, so titles and
 * summaries line up in columns no matter which icon a family uses. A terminal
 * has no such box, and the glyphs differ in width (`>_` is two cells, `⊛` is
 * one), so the same box is reproduced here by padding every icon to two cells.
 * That is the whole point of this module: without it, "Think" starts one column
 * to the left of "Bash" and the list looks ragged.
 *
 * @module hulala-cli/tui/view/rowGlyph
 */
import { visibleWidth } from '@earendil-works/pi-tui'

/** Leading disclosure column, always reserved so hover never shifts the row. */
export const GUTTER = '  '
/** Marker shown under the pointer on a foldable row. */
export const COLLAPSED = '▸'
/** Marker shown while a row is open. */
export const EXPANDED = '▾'
/** Cells the icon box occupies, matching the web client's leading icon slot. */
export const ICON_WIDTH = 2

/**
 * Pad one row glyph to the icon box so titles start in the same column.
 * @param glyph - the family or tool glyph, one or two cells wide.
 * @returns the glyph plus the padding its width is missing.
 */
export function iconBox(glyph: string): string {
  const pad = ICON_WIDTH - visibleWidth(glyph)
  return pad > 0 ? `${glyph}${' '.repeat(pad)}` : glyph
}
