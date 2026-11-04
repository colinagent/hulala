/**
 * Running indicator: the line under the turn that is still working.
 *
 * The web transcript ends a live turn with `Deep diving for 12s ···`; the
 * terminal says the same thing in one dim line with the elapsed time. The
 * clock is not owned here — the app repaints once a second while a turn is
 * running, so this component stays a pure function of the start time.
 *
 * @module hulala-cli/tui/view/runningRow
 */
import type { Component } from '@earendil-works/pi-tui'
import { buildStyles } from './theme.js'

/** Leading glyph for the active turn. */
const ICON = '✷'

/**
 * Format an elapsed duration the way the web client's run clock does:
 * `12s`, `1m 20s`, `1h 5m`.
 * @param milliseconds - elapsed time since the turn started.
 * @returns the display text.
 */
export function formatRunDuration(milliseconds: number): string {
  const total = Math.max(1, Math.round(milliseconds / 1_000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3_600)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export class RunningRow implements Component {
  constructor(
    private readonly state: () => { startedAt?: number | undefined; now?: number },
    private readonly color: boolean,
  ) {}

  invalidate(): void {}

  render(_width?: number): string[] {
    const state = this.state()
    const s = buildStyles(this.color)
    const label = state.startedAt === undefined
      ? 'Deep diving'
      : `Deep diving for ${formatRunDuration((state.now ?? Date.now()) - state.startedAt)}`
    return [`${s.accent(ICON)} ${s.dim(`${label} ···`)}`]
  }
}
