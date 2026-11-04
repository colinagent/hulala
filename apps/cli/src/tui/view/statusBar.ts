/**
 * Footer row under the composer: readings on the left, the model on the right.
 *
 * The working directory holds the far left — the rail no longer prints it above
 * its own list — then the readings: context occupancy (`14.2%/1.0M`), decode
 * speed (`269 tok/s`) and session tokens (`118M tok`). Nothing stands in for
 * them: an empty row until the first provider report is honest, and the version
 * is not something the footer has to carry.
 *
 * @module hulala-cli/tui/view/statusBar
 */
import type { Component } from '@earendil-works/pi-tui'
import { visibleWidth } from '@earendil-works/pi-tui'
import { formatTokens, tokensPerSecond } from '../data/viewModel.js'
import type { TerminalMetrics } from '../data/remote.js'
import { buildStyles } from './theme.js'
import { padEnd, shortenPath, truncateLeftText } from './pathText.js'

export interface StatusState {
  /** Working directory of the open Session, shown at the far left. */
  cwd?: string
  /** Home directory, so the path shortens the way the rail used to show it. */
  home?: string
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

    const pathText = state.cwd === undefined ? '' : shortenPath(state.cwd, Math.max(8, Math.floor(width / 2)))

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
    // The update hint stays after the one-time transcript notice scrolls away.
    const base = state.update === undefined ? readings : (readings === '' ? '' : `${readings} · `) + `update ${state.update}`
    const modelText = state.model === undefined ? '' : `${state.model.provider}/${state.model.model}`
    const modelWidth = visibleWidth(modelText)
    const pathWidth = pathText === '' ? 0 : visibleWidth(pathText) + 1
    const leftMax = Math.max(1, width - pathWidth - modelWidth - (modelWidth > 0 ? 2 : 0))
    const fitted = truncateLeftText(base, leftMax)
    const pathStyled = pathText === '' ? '' : `${styles.dim(pathText)}${fitted === '' ? '' : ' '}`
    const left = `${pathStyled}${base === '' ? '' : styles.dim(fitted === '' ? '' : fitted)}`
    const modelStyled = modelText === '' ? '' : styles.dim(modelText)
    const used = pathWidth + (fitted === '' ? 0 : visibleWidth(fitted))
    const pad = Math.max(0, width - used - modelWidth)
    return [padEnd(left + ' '.repeat(pad) + modelStyled, width)]
  }
}
