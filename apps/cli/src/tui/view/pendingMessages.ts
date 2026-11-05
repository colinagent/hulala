/**
 * Pending messages: the queue the running turn has not consumed yet.
 *
 * This is pi's `pendingMessagesContainer`, which is also the whole queue UI we
 * keep: one dim line per occurrence above the composer, steering first and then
 * follow-ups, plus the key that pulls them all back into the editor. DSH Web
 * gives each queued row its own edit/steer buttons; the terminal answers the
 * same question with one gesture, because a row of clickable actions has no
 * keyboard equivalent that would not fight the composer for arrow keys.
 *
 * The lists come from the Host's durable `inbox` projection, so every attached
 * client shows the same rows and a detached composer re-reads them on resume.
 *
 * @module hulala-cli/tui/view/pendingMessages
 */
import { truncateToWidth, type Component } from '@earendil-works/pi-tui'
import type { PendingState } from '../data/viewModel.js'
import { t } from '../i18n/index.js'
import { buildStyles } from './theme.js'

/** Left margin shared with the transcript body. */
const INDENT = 2

/** Collapse an occurrence to the single line the pending block shows. */
function oneLine(item: { text?: string | undefined }): string {
  if (item.text === undefined) return t('pending.attachments')
  return item.text.replace(/\s+/gu, ' ').trim()
}

export class PendingMessages implements Component {
  private state: PendingState = { steering: [], followUp: [] }

  constructor(private readonly color: boolean) {}

  /** Replace both lists; the app calls this after every view-model change. */
  setState(state: PendingState): void {
    this.state = state
  }

  invalidate(): void {}

  render(width: number): string[] {
    const steering = this.state.steering
    const followUp = this.state.followUp
    if (steering.length === 0 && followUp.length === 0) return []

    const styles = buildStyles(this.color)
    const inner = Math.max(1, width - INDENT)
    const row = (label: string, text: string): string =>
      ' '.repeat(INDENT) + styles.dim(truncateToWidth(`${label}${text}`, inner))
    const lines: string[] = ['']
    for (const item of steering) lines.push(row(t('pending.steering'), oneLine(item)))
    for (const item of followUp) lines.push(row(t('pending.followUp'), oneLine(item)))
    lines.push(' '.repeat(INDENT) + styles.dim(truncateToWidth(t('pending.editHint'), inner)))
    return lines
  }
}
