/**
 * Footer row under the columns: the hint and readings on the left, the route
 * and its thinking level on the right.
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
 * The right slot names the route and the thinking level it runs at
 * (`deepseek/deepseek-flash • max`), the same pair pi's footer shows. The level
 * is `reasoningEffort` when `/model` recorded one, else the catalog default the
 * Host would apply; a model that does not reason adds nothing.
 *
 * @module hulala-cli/tui/view/statusBar
 */
import type { Component } from '@earendil-works/pi-tui'
import { visibleWidth } from '@earendil-works/pi-tui'
import { formatTokens, tokensPerSecond } from '../data/viewModel.js'
import type { TerminalMetrics } from '../data/remote.js'
import { buildStyles } from './theme.js'
import { padEnd, shortenFromStart, truncateLeftText } from './pathText.js'
import { hintLine, usageHint, type UsageHint } from './hints.js'
import { permissionLabel } from './permission.js'
import { t } from '../i18n/index.js'

export interface StatusState {
  metrics: TerminalMetrics
  model?: { provider: string; model: string }
  /** Thinking level in effect for `model`; absent when the model does not reason. */
  thinkingLevel?: string
  /** Effective permission preset of the open Session; absent until the Host reports one. */
  permission?: string
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

    if (state.disconnected) return band(t('status.disconnected'))

    const readings = this.readings(state)
    // The right slot keeps its own ink: the model first, then the level, so a
    // clipped terminal leaves the level readable at the end of the row. The
    // permission preset follows them; it is not a selection state, so it stays
    // in the band's ink like every other reading instead of getting a colour
    // of its own.
    const route = state.model === undefined
      ? ''
      : `${state.model.provider}/${state.model.model}${state.thinkingLevel === undefined ? '' : ` • ${state.thinkingLevel}`}`
    const preset = state.permission === undefined
      ? ''
      : `${t('status.label.permission')} ${permissionLabel(state.permission)}`
    const modelText = [route, preset].filter(part => part !== '').join(' · ')
    const model = shortenFromStart(modelText, usable)
    const modelWidth = visibleWidth(model)
    const modelStart = usable - modelWidth

    // Centred readings: the band is one line across the frame, so the numbers
    // sit in the middle of the terminal rather than of any column. They give
    // way to the model instead of running into it.
    const gap = modelWidth > 0 ? 1 : 0
    const room = Math.max(0, modelStart - gap)
    const fitted = room > 0 ? truncateLeftText(readings, room) : ''
    const readingsWidth = visibleWidth(fitted)
    const centreStart = Math.max(0, Math.min(
      Math.floor((usable - readingsWidth) / 2),
      modelStart - gap - readingsWidth,
    ))

    // The hint owns whatever is left of the readings, and never overlaps them.
    const hint = hintLine(this.hint())
    const hintBudget = Math.max(0, Math.min(centreStart - 1, modelStart - 1))
    const hintText = hintBudget >= 6 ? truncateLeftText(hint, hintBudget) : ''

    // All three slots carry the band's own ink. A hint is no less important
    // than a reading, and dimming it was the only thing that made the row look
    // like two different surfaces.
    const styled = `${hintText}` +
      `${' '.repeat(Math.max(0, centreStart - visibleWidth(hintText)))}` +
      `${fitted}` +
      `${' '.repeat(Math.max(0, modelStart - centreStart - readingsWidth))}` +
      `${model}`
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
    return line === '' ? t('status.update', { version: state.update }) : `${line} · ${t('status.update', { version: state.update })}`
  }
}
