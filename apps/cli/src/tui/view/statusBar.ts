/**
 * Footer row under the columns: readings on the left, the model on the right.
 *
 * The row is the frame's bottom band — a full-width surface in the status
 * colour — rather than a rule under the composer. That is what lets the column
 * dividers stop above it: a horizontal rule here would meet every divider, and
 * the band separates the footer from the columns without drawing a line at all.
 * The readings: context occupancy
 * (`14.2%/1.0M`), decode speed (`269 tok/s`) and session tokens (`118M tok`).
 * Nothing stands in for them: an empty band until the first provider report is
 * honest, and the version is not something the footer has to carry. The working
 * directory is the rail's header, not the band's.
 *
 * @module hulala-cli/tui/view/statusBar
 */
import type { Component } from '@earendil-works/pi-tui'
import { visibleWidth } from '@earendil-works/pi-tui'
import { formatTokens, tokensPerSecond } from '../data/viewModel.js'
import type { TerminalMetrics } from '../data/remote.js'
import { buildStyles } from './theme.js'
import { padEnd, truncateLeftText } from './pathText.js'
import { hintLine, usageHint, type UsageHint } from './hints.js'

export interface StatusState {
  metrics: TerminalMetrics
  model?: { provider: string; model: string }
  disconnected: boolean
  /** Newer release found by the background check, shown as a persistent hint. */
  update?: string
}

export class StatusBar implements Component {
  constructor(
    private readonly state: () => StatusState,
    private readonly color: boolean,
    /** The hint for the left slot; defaults to the clock-driven rotation. */
    private readonly hint: () => UsageHint = () => usageHint(Date.now()),
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const styles = buildStyles(this.color)
    const state = this.state()
    // The band's edges are visible, so its text keeps one cell of surface on
    // either side. Below eight columns there is no room for a gutter.
    const gutter = width >= 8 ? 1 : 0
    const usable = Math.max(1, width - gutter * 2)
    const band = (text: string): string[] => [
      styles.band(`${' '.repeat(gutter)}${padEnd(text, usable)}${' '.repeat(gutter)}`),
    ]

    if (state.disconnected) return band('disconnected — reconnecting…')

    const readings = this.readings(state)
    const modelText = state.model === undefined ? '' : `${state.model.provider}/${state.model.model}`
    const modelWidth = Math.min(usable, visibleWidth(modelText))
    const modelStart = Math.max(0, usable - modelWidth)

    // Centred readings: the band is one line across the frame, so the numbers
    // sit in the middle of the terminal rather than of any column.
    const room = Math.max(1, usable - modelWidth - (modelWidth > 0 ? 1 : 0))
    const fitted = truncateLeftText(readings, room)
    const readingsWidth = visibleWidth(fitted)
    const centreStart = Math.max(0, Math.floor((usable - readingsWidth) / 2))

    // The hint owns whatever is left of the readings, and never overlaps them.
    const hint = hintLine(this.hint())
    const hintBudget = Math.max(0, Math.min(centreStart - 1, modelStart - 1))
    const hintText = hintBudget >= 6 ? truncateLeftText(hint, hintBudget) : ''

    // Style the three segments without breaking the band's fill: the band
    // wrapper re-opens its own background after every nested reset.
    const styled = `${hintText === '' ? '' : styles.dim(hintText)}` +
      `${' '.repeat(Math.max(0, centreStart - visibleWidth(hintText)))}` +
      `${fitted}` +
      `${' '.repeat(Math.max(0, modelStart - centreStart - readingsWidth))}` +
      `${modelText}`
    return band(styled)
  }

  /** The readings line: context occupancy, speed, tokens, update hint. */
  private readings(state: StatusState): string {
    const parts: string[] = []
    const contextTokens = state.metrics.contextTokens ?? 0
    const contextLimit = state.metrics.contextLimit
    if (contextLimit !== undefined && contextLimit > 0) {
      const percent = ((contextTokens / contextLimit) * 100).toFixed(1).replace(/\.0$/, '')
      parts.push(`${percent}%/${formatTokens(contextLimit)}`)
    }
    const speed = tokensPerSecond(state.metrics)
    if (speed !== undefined) parts.push(`${Math.round(speed)} tok/s`)
    const total = state.metrics.inputTokens + state.metrics.cacheReadTokens + state.metrics.outputTokens
    if (total > 0) parts.push(`${formatTokens(total)} tok`)
    const line = parts.join(' · ')
    if (state.update === undefined) return line
    return line === '' ? `update ${state.update}` : `${line} · update ${state.update}`
  }
}
