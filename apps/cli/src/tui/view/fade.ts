/**
 * A panel that is painted but not focused, one step quieter.
 *
 * The frame's columns are layout nodes, so a column's own `render` never runs:
 * the layout engine paints the lines of each leaf it finds. A panel that wants
 * "quiet while the keyboard is elsewhere" therefore wraps the leaves it owns,
 * not the column — this wrapper is that leaf. It renders the child unchanged,
 * fades the rows when the predicate says the panel is inactive, and hands the
 * pointer to the child so clicks, hover and row folding still work.
 *
 * The fade is SGR 2 rather than a second palette (see `faintLines`): every ink
 * the panel already chose — a card, a chip, a syntax colour — stays recognisable
 * and only its intensity changes.
 *
 * The wrapper never takes focus. A child that answers a press with `focus` is
 * answering for itself, so that request is left to the panel's own click path
 * instead of being rebound to this component; a wrapper that owned the keyboard
 * would have no `handleInput` to read the keys with.
 *
 * @module hulala-cli/tui/view/fade
 */
import type { Component, TuiMouseEvent, TuiMouseEventResult } from '@earendil-works/pi-tui'
import { faintLines } from './theme.js'

export class Fade implements Component {
  constructor(
    private readonly child: Component,
    /** Whether the panel this leaf belongs to is inactive right now. */
    private readonly faded: () => boolean,
    /** Whether styling is enabled; without it the rows are left alone. */
    private readonly color: boolean,
  ) {}

  render(width: number): string[] {
    const lines = this.child.render(width)
    return this.faded() ? faintLines(lines, this.color) : lines
  }

  /**
   * Pass the pointer to the leaf that owns the content.
   *
   * `focus` is dropped: the wrapper draws the content, it cannot read keys.
   * The panel's own press handler (the conversation column) has already moved
   * the keyboard by the time a child sees the gesture.
   */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const result = this.child.handleMouse?.(event)
    if (result?.focus !== true) return result
    const { focus: _focus, ...rest } = result
    return rest.handled === true ? rest : { ...rest, handled: true }
  }

  invalidate(): void {
    this.child.invalidate?.()
  }
}
