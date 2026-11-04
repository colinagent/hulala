/**
 * Usage hints for the status band's left slot.
 *
 * The client has no menu bar and no mouse affordances, so the only place a
 * shortcut can announce itself is the footer. The hints rotate: one at a time,
 * short enough to read at a glance, and never in the way of the readings in the
 * middle of the band.
 *
 * @module hulala-cli/tui/view/hints
 */

/** One hint: the keys, and what they do. */
export interface UsageHint {
  readonly keys: string
  readonly text: string
}

/** How long one hint stays on screen. */
export const HINT_INTERVAL_MS = 15_000

/**
 * The rotation, in the order a new user needs it.
 *
 * Opening a Session comes before closing a column: the rail is how a Session is
 * chosen, and the columns are what you do once one is open.
 */
export const USAGE_HINTS: readonly UsageHint[] = [
  { keys: 'Ctrl-G', text: 'show or hide the Session rail' },
  { keys: 'Ctrl-T', text: 'terminal in the Session directory' },
  { keys: 'Ctrl-F', text: 'Neovim in the right column' },
  { keys: 'Ctrl-[ Ctrl-]', text: 'move between rail, chat and column' },
  { keys: 'Ctrl-Q', text: 'detach; the Host keeps running the turn' },
  { keys: 'Esc', text: 'stop the running turn' },
  { keys: 'Ctrl-O', text: 'expand the tool row under the pointer' },
  { keys: 'Alt-Enter', text: 'queue a follow-up while a turn runs' },
  { keys: '/', text: 'commands — /help, /model, /sessions' },
]

/**
 * The hint to show at `now`.
 *
 * Time-based rather than stateful so a repaint never advances the rotation and
 * every window attached to the same Host shows the same hint.
 * @param now - epoch ms.
 * @param interval - how long one hint stays, in ms.
 * @returns the hint for this moment.
 */
export function usageHint(now: number, interval = HINT_INTERVAL_MS): UsageHint {
  const slot = Math.floor(Math.max(0, now) / Math.max(1, interval))
  return USAGE_HINTS[slot % USAGE_HINTS.length]!
}

/**
 * One hint as a single line.
 * @param hint - the hint.
 * @returns `keys — text`.
 */
export function hintLine(hint: UsageHint): string {
  return `${hint.keys} — ${hint.text}`
}
