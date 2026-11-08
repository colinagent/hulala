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
import { actionHint } from '../../keymap.js'
import { t, type MessageKey } from '../i18n/index.js'

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
 * chosen, and the columns are what you do once one is open. Each entry names the
 * key action it prints, so the band teaches the keys in force rather than the
 * defaults, and an action the user disabled leaves its hint out instead of
 * naming a key that does nothing.
 */
export function usageHints(): readonly UsageHint[] {
  const hints: Array<UsageHint | undefined> = [
    bound('panel.rail', 'hint.rail'),
    bound('panel.terminal', 'hint.terminal'),
    bound('panel.editor', 'hint.editor'),
    bound('panel.editorOnly', 'hint.editorOnly'),
    focusBinding(),
    bound('panel.commands', 'hint.palette'),
    bound('app.quit', 'hint.quit'),
    bound('app.interrupt', 'hint.escape'),
    bound('app.expand', 'hint.expand'),
    bound('app.thinking', 'hint.thinking'),
    // pi's own submit gesture, not a hulala action: it is not rebindable here.
    { keys: 'Alt-Enter', text: t('hint.queue') },
    { keys: '/', text: t('hint.commands') },
  ]
  return hints.filter((hint): hint is UsageHint => hint !== undefined)
}

/** One action's hint, or nothing when the action is disabled. */
function bound(id: string, key: MessageKey): UsageHint | undefined {
  const keys = actionHint(id)
  return keys === '' ? undefined : { keys, text: t(key) }
}

/** Both ends of the focus movement, on the row that explains it. */
function focusBinding(): UsageHint | undefined {
  const left = actionHint('panel.focusLeft')
  const right = actionHint('panel.focusRight')
  const keys = [left, right].filter(part => part !== '').join(' / ')
  return keys === '' ? undefined : { keys, text: t('hint.focus') }
}

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
  const hints = usageHints()
  return hints[slot % hints.length]!
}

/**
 * One hint as a single line.
 * @param hint - the hint.
 * @returns `keys — text`.
 */
export function hintLine(hint: UsageHint): string {
  return `${hint.keys} — ${hint.text}`
}
