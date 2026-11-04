/**
 * Draggable column rule between the conversation and the editor.
 *
 * The divider owns no layout state: it reports the absolute column the pointer
 * is over and the caller turns that into a ratio. It paints itself with the
 * editor's own background colour so the divider and the colour boundary are the
 * same column rather than two adjacent ones, and it brightens plus asks the
 * terminal for a resize pointer while hovered.
 *
 * @module hulala-cli/tui/view/splitDivider
 */
import {
  MouseRegion,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from '@earendil-works/pi-tui'
import { buildStyles } from './theme.js'

export interface SplitDividerOptions {
  /** Rows to paint; the divider spans the full column height. */
  readonly rows: () => number
  readonly color: boolean
  /** Background SGR of the editor, so the column reads as its left border. */
  readonly background: () => string
  /** Absolute terminal column under the pointer while dragging. */
  readonly onDrag: (screenX: number) => void
  /** Hover entered or left; the caller owns the terminal pointer shape. */
  readonly onHover: (hovered: boolean) => void
}

export interface SplitDivider {
  readonly component: Component
  /** Set by whichever component the pointer moved to. */
  setHovered(hovered: boolean): void
}

const RESET = '\u001b[0m'

class Divider implements Component {
  private hovered = false

  constructor(
    private readonly options: SplitDividerOptions,
    private readonly idle: string,
    private readonly active: string,
  ) {}

  setHovered(hovered: boolean): void {
    this.hovered = hovered
  }

  render(): string[] {
    const background = this.options.background()
    const rule = this.hovered ? this.active : this.idle
    const line = `${background}${rule}${RESET}`
    return Array.from({ length: Math.max(1, this.options.rows()) }, () => line)
  }

  invalidate(): void {}
}

/**
 * A plain one-column rule with no pointer handling.
 *
 * The session rail is fixed-width, so the rule beside it is not a drag target;
 * reusing the draggable divider would advertise a resize that does not exist.
 * @param rows - rows to paint.
 * @param color - whether ANSI styling is on.
 * @returns the rule component.
 */
export function columnRule(rows: () => number, color: boolean): Component {
  const styles = buildStyles(color)
  return {
    invalidate: () => undefined,
    render: () => Array.from({ length: Math.max(1, rows()) }, () => styles.dim('▏')),
  }
}

/**
 * Build the divider, wrapped so a press captures the drag and hovering asks for
 * a resize pointer.
 * @param options - height, colours, drag and hover callbacks.
 * @returns the component and the hover setter the neighbouring views call.
 */
export function splitDivider(options: SplitDividerOptions): SplitDivider {
  const styles = buildStyles(options.color)
  // Block glyphs are drawn at the cell edge by the terminal, unlike `│` which
  // is centred in its cell. The cell carries the editor background, so a
  // left-edge block puts the rule exactly on the column boundary instead of a
  // half cell inside the editor. Hover thickens the block.
  const divider = new Divider(options, styles.dim('▏'), styles.accent('▎'))
  const setHovered = (hovered: boolean): void => {
    divider.setHovered(hovered)
    options.onHover(hovered)
  }
  const component = new MouseRegion(divider, (event: TuiMouseEvent): TuiMouseEventResult | undefined => {
    if (event.type === 'move') {
      setHovered(true)
      return { handled: true }
    }
    if (event.type === 'press' && event.button === 'left') {
      setHovered(true)
      return { handled: true, capture: true }
    }
    if (event.type === 'drag') {
      options.onDrag(event.screenX)
      return { handled: true, capture: true }
    }
    if (event.type === 'release') return { handled: true }
    return undefined
  })
  return { component, setHovered }
}
