/**
 * The mouse report a program in a column expects from its terminal.
 *
 * A column runs a real program in a pty, and a program that tracks the mouse
 * (Neovim sets `mouse=a`) reads the same SGR reports a terminal would send. The
 * client is that terminal for the column, so a pointer event over the pane has
 * to become the bytes the program already asked for.
 *
 * Only three event kinds are reports: a press, a motion with the button held,
 * and the release. `click` is the renderer's own synthesis on top of a release,
 * and the wheel never reaches a component at all — the renderer routes it to a
 * scroll view before dispatch — so both produce nothing here.
 *
 * @module hulala-cli/tui/view/sgrMouse
 */
import type { TuiMouseEvent } from '@earendil-works/pi-tui'

/** SGR button codes: the low two bits name the button. */
const BUTTON_CODE: Readonly<Record<string, number>> = { left: 0, middle: 1, right: 2, none: 3 }

/** The motion bit: set while the pointer moves with a button held. */
const MOTION = 32

/** Modifier bits, in the order the protocol adds them to the button code. */
const MODIFIERS: ReadonlyArray<readonly [keyof TuiMouseEvent, number]> = [
  ['shift', 4],
  ['alt', 8],
  ['ctrl', 16],
]

/**
 * Encode one pointer event as an SGR (1006) mouse report.
 *
 * Coordinates are cell-based and zero-based in the event, one-based in the
 * protocol, and local to the receiving component — which is exactly the origin
 * the program draws from. A release ends with `m`, everything else with `M`.
 * @param event - the pointer event the renderer dispatched to the pane.
 * @returns the report, or undefined when the event is not one a program sees.
 */
export function sgrMouse(event: TuiMouseEvent): string | undefined {
  const button = BUTTON_CODE[event.button] ?? 3
  let code: number
  let final: string
  switch (event.type) {
    case 'press':
      code = button
      final = 'M'
      break
    case 'drag':
      code = MOTION + button
      final = 'M'
      break
    case 'release':
      code = button
      final = 'm'
      break
    default:
      return undefined
  }
  for (const [modifier, bit] of MODIFIERS) {
    if (event[modifier] === true) code += bit
  }
  return `\u001b[<${code};${event.x + 1};${event.y + 1}${final}`
}
