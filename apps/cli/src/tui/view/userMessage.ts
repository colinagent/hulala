/**
 * Archived user message.
 *
 * Claude Code keeps the operator's own prompts visually separate from the
 * assistant transcript by drawing them as a full-width row with a background
 * colour. This component does the same: every wrapped line is padded to the
 * terminal width and filled with the panel colour, the first line carries a
 * muted `❯` arrow, and continuation lines indent under the message text so a
 * wrapped prompt still reads as one block.
 *
 * The block is padded vertically with two *panel* rows, not page rows — pi's
 * user message is a `Markdown` with `paddingY: 1` and a background, and the tool
 * card here draws its own fill above and below for the same reason. A one-row
 * chip with page-coloured gaps reads as a highlighted line rather than as the
 * operator's own turn.
 *
 * The band, its text and the arrow all come from `buildStyles`: the band is the
 * editor's `##` heading tint — the terminal's page moved a tenth of the way
 * towards the palette's yellow — the text is the terminal's own foreground, and
 * the arrow is that ink faded towards the band. Colour derivations live there so
 * one terminal answer places every surface; with colour disabled (`NO_COLOR`)
 * this degrades to plain text.
 *
 * @module hulala-cli/tui/view/userMessage
 */
import { visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui'
import { buildStyles } from './theme.js'

/** One arrow (or two indent spaces) plus a leading and trailing pad column. */
const PREFIX_WIDTH = 3
/** Keep one panel column of padding on the right, like the transcript body. */
const RIGHT_PADDING = 1

export class UserMessage implements Component {
  private readonly styles: ReturnType<typeof buildStyles>
  /** The wrapped panel for one width; a frame in a long transcript asks again and again. */
  private cached: { width: number; lines: string[] } | undefined

  constructor(private readonly text: string, color: boolean) {
    this.styles = buildStyles(color)
  }

  invalidate(): void {
    this.cached = undefined
  }

  render(width: number): string[] {
    if (this.cached !== undefined && this.cached.width === width) return this.cached.lines
    const contentWidth = Math.max(1, width - PREFIX_WIDTH - RIGHT_PADDING)
    const lines = wrapTextWithAnsi(this.text.replace(/\t/gu, '   '), contentWidth)
    // Bracket the panel with a blank row of its own fill, so the block reads as
    // its own turn instead of running into the transcript around it, and the
    // prompt is not squeezed against the chip's edge.
    const blank = this.styles.userPanel(' '.repeat(Math.max(0, width)))
    const rendered = [blank, ...lines.map((line, index) => this.panelLine(line, index === 0, width)), blank]
    this.cached = { width, lines: rendered }
    return rendered
  }

  private panelLine(text: string, first: boolean, width: number): string {
    const marker = first ? `${this.styles.userArrow('❯')} ` : '  '
    const body = ` ${marker}${text}`
    const missing = width - visibleWidth(body)
    const padded = missing > 0 ? body + ' '.repeat(missing) : body
    return this.styles.userPanel(padded)
  }
}
