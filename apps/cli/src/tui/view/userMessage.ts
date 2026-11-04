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
 * The panel and text colours both come from `buildStyles`, which pins a fixed
 * foreground so the block stays legible on light and dark terminals. With
 * colour disabled (`NO_COLOR`) this degrades to plain text.
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

  constructor(private readonly text: string, color: boolean) {
    this.styles = buildStyles(color)
  }

  render(width: number): string[] {
    const contentWidth = Math.max(1, width - PREFIX_WIDTH - RIGHT_PADDING)
    const lines = wrapTextWithAnsi(this.text.replace(/\t/gu, '   '), contentWidth)
    // Bracket the panel with a blank row so the block reads as its own turn
    // instead of running into the assistant text above and below it.
    const blank = ' '.repeat(Math.max(0, width))
    return [blank, ...lines.map((line, index) => this.panelLine(line, index === 0, width)), blank]
  }

  invalidate(): void {}

  private panelLine(text: string, first: boolean, width: number): string {
    const marker = first ? `${this.styles.userArrow('❯')} ` : '  '
    const body = ` ${marker}${text}`
    const missing = width - visibleWidth(body)
    const padded = missing > 0 ? body + ' '.repeat(missing) : body
    return this.styles.userPanel(padded)
  }
}
