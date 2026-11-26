/**
 * Bordered panel lines shared by the modal overlays.
 *
 * Body and footer lines wrap at the panel's inner width instead of being
 * clipped: a Host's approval reason is a sentence, and a sentence cut at the
 * border (`部署需要写 /app/trader、/...`) reads as a denial of everything after
 * the cut. `truncateToWidth` still guards every row, because pi-tui rejects a
 * line wider than the width it asked for and a single grapheme can be.
 *
 * A caller that knows the terminal's height passes `maxBodyRows`; the body then
 * stops growing and the last row is a `…`, so a long reason cannot push the
 * panel's own title and keys off screen.
 *
 * Pure string layout over pi-tui's width helpers; no terminal writes.
 *
 * @module hulala-cli/tui/view/overlays/panel
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'

/** What a panel may spend its height on. */
export interface PanelOptions {
  /**
   * Body rows before the panel stops growing. Omitted means the body decides,
   * which is right for a fixed set of labels and wrong for text a model wrote.
   */
  readonly maxBodyRows?: number
}

function clip(text: string, width: number): string {
  return truncateToWidth(text, width)
}

function pad(text: string, width: number): string {
  const missing = width - visibleWidth(text)
  return missing > 0 ? text + ' '.repeat(missing) : text
}

/** One input line as the rows it occupies at `width`. */
function wrap(line: string, width: number): string[] {
  const rows = wrapTextWithAnsi(line, width)
  return rows.length === 0 ? [''] : rows
}

/**
 * The body as rows, capped when the caller gave a budget.
 *
 * The cap keeps the panel's frame, title and footer on screen; the `…` says the
 * body is shorter than what the Host sent, rather than pretending it ended.
 */
function bodyRows(body: readonly string[], width: number, maxRows: number | undefined): string[] {
  const rows = body.flatMap((line) => wrap(line, width))
  if (maxRows === undefined || rows.length <= maxRows) return rows
  return [...rows.slice(0, Math.max(0, maxRows - 1)), '…']
}

/** Compose a titled, bordered panel. */
export function panel(
  width: number,
  title: string,
  body: readonly string[],
  footer: readonly string[] = [],
  options: PanelOptions = {},
): string[] {
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
  const rows = bodyRows(body, inner, options.maxBodyRows)
  // The footer is one line per entry by contract (the keys), and a wrapped key
  // row would move the panel's floor; it wraps anyway rather than losing a key.
  const footerRows = footer.flatMap((line) => wrap(line, inner))
  for (const line of [...rows, ...footerRows]) lines.push(`│ ${pad(clip(line, inner), inner)} │`)
  lines.push(`└${'─'.repeat(edge)}┘`)
  return lines
}
