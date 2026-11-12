/**
 * Shapes the terminal client kernel and its panels share.
 *
 * Types only, and deliberately small: the panel contract that used to live in
 * `@hulala/tui-panel-types` was the user-plugin door, which no longer exists.
 * What remains is the one thing every panel and the frame agree on — where a
 * panel may draw.
 *
 * @module hulala-cli/tui/types
 */

/**
 * Where a component can be put.
 *
 * The set is closed, and each seat has its own size policy that a panel cannot
 * change: the terminal is a fixed cell grid, so geometry belongs to the frame.
 *
 * Two kinds. **Exclusive** seats (`main`, `dock.cwd`, `dock.input`, `rail`,
 * `pane`) belong to one owner; a second claimant is refused with the occupant's
 * id in the message, because a silent replacement looks exactly like a panel
 * that never loaded. **Stacked** seats (`dock.pending`, `dock.status`) draw
 * every owner's rows in registration order.
 */
export type SeatId =
  /** The transcript viewport. Exclusive. */
  | 'main'
  /** Rows directly above the composer. Stacked. */
  | 'dock.pending'
  /** The working-directory row. Exclusive, and absent while the rail is shown. */
  | 'dock.cwd'
  /** The composer. Exclusive; a picker borrows the slot rather than sharing it. */
  | 'dock.input'
  /** The status row under the composer. Stacked. */
  | 'dock.status'
  /** Left column. Exclusive; yields its width on a narrow terminal. */
  | 'rail'
  /** Right column: a program in a pty. Exclusive. */
  | 'pane'
