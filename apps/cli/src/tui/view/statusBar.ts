/**
 * Footer row under the composer: readings on the left, the model on the right.
 *
 * The readings are context occupancy (`14.2%/1.0M`), decode speed
 * (`269 tok/s`) and session tokens (`118M tok`). Until the first provider
 * report arrives there is nothing to show, so the version stands in as a
 * placeholder — the footer is the only place it is visible now that the title
 * row is gone — and it disappears the moment a reading exists.
 *
 * @module hulala-cli/tui/view/statusBar
 */
import type { Component } from '@earendil-works/pi-tui'
import { visibleWidth } from '@earendil-works/pi-tui'
import { formatTokens, tokensPerSecond } from '../data/viewModel.js'
import type { TerminalMetrics } from '../data/remote.js'
import { buildStyles } from './theme.js'
import { padEnd, truncateLeftText } from './pathText.js'
import { VERSION } from '../../constants.js'

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
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const styles = buildStyles(this.color)
    const state = this.state()

    if (state.disconnected) {
      return [padEnd(styles.dim('disconnected — reconnecting…'), width)]
    }

    const readingsParts: string[] = []

    // Context occupancy: only once the provider reports a context window.
    const contextTokens = state.metrics.contextTokens ?? 0
    const contextLimit = state.metrics.contextLimit
    if (contextLimit !== undefined && contextLimit > 0) {
      const percent = ((contextTokens / contextLimit) * 100).toFixed(1).replace(/\.0$/, '')
      readingsParts.push(`${percent}%/${formatTokens(contextLimit)}`)
    }

    const speed = tokensPerSecond(state.metrics)
    if (speed !== undefined) readingsParts.push(`${Math.round(speed)} tok/s`)

    const total = state.metrics.inputTokens + state.metrics.cacheReadTokens + state.metrics.outputTokens
    if (total > 0) readingsParts.push(`${formatTokens(total)} tok`)

    const readings = readingsParts.join(' · ')
    // No reading yet: the version holds the space until one arrives. An update
    // hint stays here after the one-time transcript notice scrolls away.
    const base = readings === '' ? `hulala v${VERSION}` : readings
    const leftText = state.update === undefined ? base : `${base} · update ${state.update}`
    const modelText = state.model === undefined ? '' : `${state.model.provider}/${state.model.model}`
    const modelWidth = visibleWidth(modelText)
    const leftMax = Math.max(1, width - modelWidth - (modelWidth > 0 ? 2 : 0))
    const fitted = truncateLeftText(leftText, leftMax)
    const styled = readings === '' ? styles.brand(fitted) : styles.dim(fitted)
    const modelStyled = modelText === '' ? '' : styles.dim(modelText)
    const pad = Math.max(0, width - visibleWidth(fitted) - modelWidth)
    return [padEnd(styled + ' '.repeat(pad) + modelStyled, width)]
  }
}
