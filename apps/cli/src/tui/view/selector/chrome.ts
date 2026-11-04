/**
 * Chrome shared by the composer-replacing selectors.
 *
 * pi's pickers are not floating dialogs: they take the editor's place in the
 * dock, framed by one full-width rule above and below, so the transcript above
 * keeps its own rows. The same shape is used here for `/model`, `/login`, and
 * the API-key field.
 *
 * @module hulala-cli/tui/view/selector/chrome
 */
import type { Component } from '@earendil-works/pi-tui'

/** Rows a selector list may show before it starts scrolling. */
export const MAX_VISIBLE = 8

/** Full-width horizontal rule that closes a selector like pi's `DynamicBorder`. */
export class Rule implements Component {
  private readonly style: (text: string) => string

  constructor(style: (text: string) => string = text => text) {
    this.style = style
  }

  invalidate(): void {}

  render(width: number): string[] {
    return [this.style('─'.repeat(Math.max(1, width)))]
  }
}

/**
 * How many list rows fit this terminal.
 *
 * The frame around a selector is fixed (rules, hint lines, the search field,
 * the selected-model detail), so the list gets what is left, bounded by
 * {@link MAX_VISIBLE} and never smaller than three rows.
 * @param rows - terminal rows.
 * @param chromeRows - rows the frame around the list takes.
 * @returns the number of visible list rows.
 */
export function listCapacity(rows: number, chromeRows = 12): number {
  return Math.max(3, Math.min(MAX_VISIBLE, Math.floor(rows) - chromeRows))
}

/**
 * The slice of `items` a window centred on `cursor` shows.
 * @param items - the filtered list.
 * @param cursor - the selected index.
 * @param capacity - rows the window may use.
 * @returns the visible items and the index of the first one.
 */
export function windowOf<T>(items: readonly T[], cursor: number, capacity: number): { items: readonly T[]; start: number } {
  const start = Math.max(0, Math.min(cursor - Math.floor(capacity / 2), items.length - capacity))
  return { items: items.slice(start, start + capacity), start }
}

/**
 * Scroll position text, e.g. `(3/42)`, shown only while the list overflows.
 * @param cursor - selected index.
 * @param total - filtered length.
 * @param start - first visible index.
 * @param capacity - visible rows.
 * @returns the line text, or undefined when everything fits.
 */
export function scrollLabel(cursor: number, total: number, start: number, capacity: number): string | undefined {
  if (start <= 0 && start + capacity >= total) return undefined
  return `  (${cursor + 1}/${total})`
}
