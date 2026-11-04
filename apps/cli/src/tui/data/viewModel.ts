/**
 * View model: durable events → transcript items + metrics.
 *
 * Pure, terminal-free, and unit-testable. The reducer owns the transcript
 * items, the running/busy flag, the turn start time, and the token/speed
 * accumulator; the app owns the Session identity, cwd, model, and connection
 * state.
 *
 * Items keep the raw, still-uninterpreted record — a tool call holds its
 * argument JSON and flattened result text, a reasoning block holds its text —
 * and `data/toolRow.ts` turns a tool item into the row the terminal draws. That
 * split is what lets the row model mirror the DeepSeek Harness web client
 * without a terminal in the loop.
 *
 * @module hulala-cli/tui/data/viewModel
 */
import type { TerminalInbox, TerminalMetrics, TerminalPendingMessage, TerminalSessionEvent } from './remote.js'

/** Lifecycle of one tool call, matching the web client's row states. */
export type ToolStatus = 'preparing' | 'running' | 'ok' | 'error' | 'stopped'

/** One rendered transcript entry. */
export type TranscriptItem =
  | { kind: 'user'; text: string; time: number }
  | { kind: 'reasoning'; text: string; streaming: boolean; time: number }
  | { kind: 'assistant'; text: string; streaming: boolean; time: number }
  | {
      kind: 'tool'
      name: string
      /** Argument JSON exactly as the model produced it, unparsed. */
      args: string
      /** Flattened result text; `undefined` until the call settles. */
      result?: string
      status: ToolStatus
      errorCode?: string
      /** Tool-private presentation payload persisted on `tool/result`. */
      meta?: unknown
      time: number
      durationMs?: number
    }
  | { kind: 'error'; message: string; time: number }
  | { kind: 'summary'; text: string; time: number }
  | { kind: 'notice'; text: string; tone?: 'warn' | 'info'; time: number }

/**
 * Both durable pending lists as the composer's pending block shows them.
 *
 * The Host owns these: a second client attached to the same Session sees the
 * same rows, and re-opening a Session restores them from the `inbox`
 * projection rather than from anything this reducer remembered.
 */
export interface PendingState {
  /** `next-step`: text the running turn claims at its next step boundary. */
  readonly steering: readonly TerminalPendingMessage[]
  /** `next-turn`: follow-up turns queued behind the running one. */
  readonly followUp: readonly TerminalPendingMessage[]
}

/** Token buckets DSH reports on one settled step. */
export interface StepUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number | undefined
}

/** Join the text blocks of one message or tool result. */
export function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(block => {
      if (block === null || typeof block !== 'object') return []
      const record = block as { type?: unknown; text?: unknown }
      return record.type === 'text' && typeof record.text === 'string' ? [record.text] : []
    })
    .join('\n')
}

/** Join the reasoning blocks of one assistant message (replayed history). */
export function reasoningOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(block => {
      if (block === null || typeof block !== 'object') return []
      const record = block as { type?: unknown; text?: unknown }
      return record.type === 'reasoning' && typeof record.text === 'string' ? [record.text] : []
    })
    .join('\n')
}

/** Flatten settled tool-result content: text verbatim, other blocks as JSON. */
export function resultText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(block => {
      if (block === null || typeof block !== 'object') return []
      const record = block as { type?: unknown; text?: unknown }
      if (record.type === 'text' && typeof record.text === 'string') return [record.text]
      return [JSON.stringify(block, null, 2)]
    })
    .join('\n')
}

function stringAt(value: unknown, ...path: readonly string[]): string | undefined {
  let current = value
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' ? current : undefined
}

/** True when the tool's presentation payload marks a partially applied call. */
export function stoppedByMeta(meta: unknown): boolean {
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta)
    && (meta as Record<string, unknown>).stopped === true
}

/**
 * Map one settled call onto a row state: an interrupted failure and a
 * `meta.stopped` payload both mean "started but did not finish".
 * @param input - failure identity and the tool-private payload.
 * @returns the row state for the settled call.
 */
export function toolStatusOf(input: { isError?: boolean; errorCode?: string; meta?: unknown }): ToolStatus {
  if (input.errorCode === 'interrupted' || stoppedByMeta(input.meta)) return 'stopped'
  return input.isError === true ? 'error' : 'ok'
}

export function emptyMetrics(): TerminalMetrics {
  return { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, decodeMs: 0 }
}

export function usageOf(data: unknown): StepUsage | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const usage = (data as { usage?: unknown }).usage
  if (usage === null || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>
  const input = record.inputTokens
  const output = record.outputTokens
  if (typeof input !== 'number' || typeof output !== 'number') return undefined
  const cache = record.cacheReadTokens
  return {
    inputTokens: input,
    outputTokens: output,
    ...(typeof cache === 'number' ? { cacheReadTokens: cache } : {}),
  }
}

export function addUsage(metrics: TerminalMetrics, usage: StepUsage): TerminalMetrics {
  return {
    ...metrics,
    inputTokens: metrics.inputTokens + usage.inputTokens,
    cacheReadTokens: metrics.cacheReadTokens + (usage.cacheReadTokens ?? 0),
    outputTokens: metrics.outputTokens + usage.outputTokens,
  }
}

export function addDecode(metrics: TerminalMetrics, milliseconds: number): TerminalMetrics {
  if (!(milliseconds > 0)) return metrics
  return { ...metrics, decodeMs: metrics.decodeMs + milliseconds }
}

/** Compact token count matching pi's footer: 950, 1.2k, 12k, 118k, 1.0M, 118M. */
export function formatTokens(count: number): string {
  if (count < 1000) return count.toString()
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`
  return `${Math.round(count / 1000000)}M`
}

export function cacheHitPercent(metrics: TerminalMetrics): number | undefined {
  const promptSide = metrics.inputTokens + metrics.cacheReadTokens
  if (promptSide <= 0 || metrics.cacheReadTokens <= 0) return undefined
  return Math.round((metrics.cacheReadTokens / promptSide) * 100)
}

export function tokensPerSecond(metrics: TerminalMetrics): number | undefined {
  if (metrics.decodeMs <= 0 || metrics.outputTokens <= 0) return undefined
  return (metrics.outputTokens / metrics.decodeMs) * 1_000
}

/** Compose the readings joined by separators, or an empty string. */
export function metricsText(metrics: TerminalMetrics): string {
  const readings: string[] = []
  const speed = tokensPerSecond(metrics)
  if (speed !== undefined) readings.push(`${speed.toFixed(1)} tok/s`)
  const cache = cacheHitPercent(metrics)
  if (cache !== undefined) readings.push(`${cache}% cache`)
  const total = metrics.inputTokens + metrics.cacheReadTokens + metrics.outputTokens
  if (total > 0) readings.push(`${formatTokens(total)} tokens`)
  return readings.join(' · ')
}

interface ToolTracking {
  index: number
  startedAt: number
}

/**
 * Keep the text a stream delivered, unless the durable record is longer — a
 * dropped connection can cut the deltas short, and the message is the truth.
 * @param streamed - text accumulated from deltas.
 * @param durable - text the committed message carries.
 * @returns the text to keep.
 */
function complete(streamed: string, durable: string): string {
  if (durable === '') return streamed
  if (streamed === '') return durable
  if (durable.length > streamed.length && durable.startsWith(streamed)) return durable
  return streamed
}

/**
 * Reducer for one Session's transcript.
 */
export class ViewModelReducer {
  items: TranscriptItem[] = []
  metrics: TerminalMetrics = emptyMetrics()
  busy = false
  /** True while an assistant attempt is streaming text or reasoning. */
  streaming = false
  /** Closed steps (`step/end`) seen so far. */
  steps = 0
  /** Wall-clock start of the current turn, for the running indicator. */
  turnStartedAt: number | undefined
  /** Both durable pending lists, mirrored from the `inbox` projection. */
  pending: PendingState = { steering: [], followUp: [] }
  private decodeStartedAt = 0
  /** Index of the first item the live attempt streamed; -1 outside an attempt. */
  private attemptStart = -1
  private readonly toolCalls = new Map<string, ToolTracking>()
  private readonly turnNumbers = new Set<number>()

  /** Distinct turns that carried at least one closed step (like DSH's sessionStats). */
  get turns(): number {
    return this.turnNumbers.size
  }

  reset(): void {
    this.items = []
    this.metrics = emptyMetrics()
    this.busy = false
    this.streaming = false
    this.steps = 0
    this.turnStartedAt = undefined
    this.pending = { steering: [], followUp: [] }
    this.decodeStartedAt = 0
    this.attemptStart = -1
    this.toolCalls.clear()
    this.turnNumbers.clear()
  }

  /** Record context occupancy from the `contextPressure` projection. */
  setContextPressure(tokens: number | undefined, limit: number | undefined): void {
    this.metrics = {
      ...this.metrics,
      ...(tokens === undefined ? {} : { contextTokens: tokens }),
      ...(limit === undefined ? {} : { contextLimit: limit }),
    }
  }

  /** Replace both pending lists from the Host's `inbox` projection. */
  setInbox(inbox: TerminalInbox): void {
    this.pending = { steering: [...inbox.steering], followUp: [...inbox.followUp] }
  }

  /** Total pending occurrences the composer still owns. */
  get pendingCount(): number {
    return this.pending.steering.length + this.pending.followUp.length
  }

  setRunning(running: boolean): void {
    this.busy = running
    if (running) {
      this.turnStartedAt ??= Date.now()
      return
    }
    this.turnStartedAt = undefined
    this.endStream()
  }

  /** Append one reasoning delta, opening a new block when the tail settled. */
  applyReasoningDelta(text: string): void {
    if (text === '') return
    const last = this.items[this.items.length - 1]
    if (last === undefined || last.kind !== 'reasoning' || !last.streaming) {
      this.sealStreaming()
      if (this.attemptStart < 0) this.attemptStart = this.items.length
      this.items.push({ kind: 'reasoning', text: '', streaming: true, time: Date.now() })
    }
    const current = this.items[this.items.length - 1]
    if (current !== undefined && current.kind === 'reasoning') current.text += text
  }

  applyDelta(text: string): void {
    if (text === '') return
    if (this.decodeStartedAt === 0) this.decodeStartedAt = Date.now()
    const last = this.items[this.items.length - 1]
    if (last === undefined || last.kind !== 'assistant' || !last.streaming) {
      this.sealStreaming()
      if (this.attemptStart < 0) this.attemptStart = this.items.length
      this.items.push({ kind: 'assistant', text: '', streaming: true, time: Date.now() })
    }
    const current = this.items[this.items.length - 1]
    if (current !== undefined && current.kind === 'assistant') current.text += text
  }

  endStream(): void {
    if (this.decodeStartedAt !== 0) {
      this.metrics = addDecode(this.metrics, Date.now() - this.decodeStartedAt)
      this.decodeStartedAt = 0
    }
    this.sealStreaming()
  }

  addNotice(text: string, tone?: 'warn' | 'info'): void {
    this.items.push({ kind: 'notice', text, time: Date.now(), ...(tone === undefined ? {} : { tone }) })
  }

  addError(message: string): void {
    this.items.push({ kind: 'error', message, time: Date.now() })
  }

  applyEvent(event: TerminalSessionEvent): void {
    switch (event.type) {
      case 'user/message': {
        const source = stringAt(event.data, 'source', 'kind')
        if (source !== undefined && source !== 'user') return
        const text = textOf((event.data as { content?: unknown }).content)
        if (text.trim() === '') return
        this.attemptStart = -1
        this.dropPending(stringAt(event.data, 'id'))
        this.items.push({ kind: 'user', text, time: event.time })
        return
      }
      case 'assistant/message': {
        const usage = usageOf(event.data)
        if (usage !== undefined) this.metrics = addUsage(this.metrics, usage)
        const content = (event.data as { message?: { content?: unknown } }).message?.content
        this.settleAttempt(content, event.time)
        return
      }
      case 'assistant/attempt': {
        // An attempt that committed no surface message: seal it and let the
        // next attempt start a fresh range.
        this.endStream()
        this.attemptStart = -1
        return
      }
      case 'tool/call': {
        const callId = stringAt(event.data, 'callId')
        const name = stringAt(event.data, 'name') ?? 'tool'
        const args = stringAt(event.data, 'arguments') ?? ''
        this.attemptStart = -1
        this.items.push({ kind: 'tool', name, args, status: 'running', time: event.time })
        if (callId !== undefined) this.toolCalls.set(callId, { index: this.items.length - 1, startedAt: Date.now() })
        return
      }
      case 'tool/result': {
        const data = event.data as {
          message?: { toolCallId?: unknown; isError?: unknown; content?: unknown }
          error?: { code?: unknown }
          meta?: unknown
        }
        const callId = typeof data.message?.toolCallId === 'string' ? data.message.toolCallId : undefined
        const isError = data.message?.isError === true
        const errorCode = typeof data.error?.code === 'string' ? data.error.code : undefined
        const meta = data.meta
        const result = resultText(data.message?.content)
        const status = toolStatusOf({ isError, ...(errorCode === undefined ? {} : { errorCode }), meta })
        const tracked = callId === undefined ? undefined : this.toolCalls.get(callId)
        if (callId !== undefined) this.toolCalls.delete(callId)
        const item = tracked === undefined ? undefined : this.items[tracked.index]
        if (tracked !== undefined && item !== undefined && item.kind === 'tool') {
          item.status = status
          item.result = result
          if (errorCode !== undefined) item.errorCode = errorCode
          if (meta !== undefined) item.meta = meta
          item.durationMs = Date.now() - tracked.startedAt
          return
        }
        this.items.push({
          kind: 'tool', name: 'tool', args: '', result, status, time: event.time,
          ...(errorCode === undefined ? {} : { errorCode }),
          ...(meta === undefined ? {} : { meta }),
        })
        return
      }
      case 'compaction/summary': {
        const text = textOf((event.data as { summary?: unknown }).summary)
        if (text.trim() !== '') this.items.push({ kind: 'summary', text, time: event.time })
        return
      }
      case 'request/context': {
        // The model route advertises its context window once a request binds it.
        const contextWindow = (event.data as { contextWindow?: unknown }).contextWindow
        if (typeof contextWindow === 'number' && contextWindow > 0) {
          this.metrics = { ...this.metrics, contextLimit: contextWindow }
        }
        return
      }
      case 'step/end': {
        this.attemptStart = -1
        this.steps += 1
        const turn = (event.data as { turn?: unknown }).turn
        if (typeof turn === 'number') this.turnNumbers.add(turn)
        return
      }
      case 'turn/start': {
        this.busy = true
        this.turnStartedAt = event.time > 0 ? event.time : Date.now()
        return
      }
      case 'turn/end': {
        this.attemptStart = -1
        this.busy = false
        this.turnStartedAt = undefined
        this.endStream()
        const kind = stringAt(event.data, 'reason', 'kind')
        if (kind === 'error') {
          this.items.push({ kind: 'error', message: stringAt(event.data, 'reason', 'error', 'message') ?? 'turn failed', time: event.time })
        } else if (kind === 'aborted') {
          this.items.push({ kind: 'notice', text: 'Turn cancelled', time: event.time })
        } else if (kind === 'blocked') {
          this.items.push({ kind: 'error', message: 'Turn blocked', time: event.time })
        }
        return
      }
      case 'error': {
        this.items.push({ kind: 'error', message: stringAt(event.data, 'message') ?? stringAt(event.data, 'error', 'message') ?? 'session error', time: event.time })
        return
      }
      default:
        return
    }
  }

  /**
   * Drop one occurrence a durable `user/message` just claimed.
   *
   * The claim is logged as an event before the inbox projection publishes its
   * removal, so the event is the earlier word; dropping here keeps the pending
   * block from echoing a message the transcript already shows.
   * @param id - identity of the admitted message, when the event carries one.
   */
  private dropPending(id: string | undefined): void {
    if (id === undefined || this.pendingCount === 0) return
    const keep = (list: readonly TerminalPendingMessage[]): TerminalPendingMessage[] =>
      list.some(item => item.id === id) ? list.filter(item => item.id !== id) : [...list]
    this.pending = { steering: keep(this.pending.steering), followUp: keep(this.pending.followUp) }
  }

  /** Close whichever item is currently streaming without ending decode timing. */
  private sealStreaming(): void {
    const last = this.items[this.items.length - 1]
    if (last === undefined) return
    if ((last.kind === 'assistant' || last.kind === 'reasoning') && last.streaming) last.streaming = false
  }

  /**
   * Settle the attempt a durable `assistant/message` closes.
   *
   * The live stream already rendered this attempt's reasoning and answer; the
   * durable message is the same content, not a second one. Settling in place is
   * what keeps a turn from being printed twice — DSH's web client keys its
   * nodes by attempt identity for the same reason.
   *
   * History replay has no deltas, so there the durable message is the only
   * source and its blocks are appended.
   */
  private settleAttempt(content: unknown, time: number): void {
    const reasoning = reasoningOf(content)
    const text = textOf(content)
    const start = this.attemptStart
    this.attemptStart = -1

    if (start < 0) {
      if (reasoning !== '') this.items.push({ kind: 'reasoning', text: reasoning, streaming: false, time })
      if (text.trim() !== '') this.items.push({ kind: 'assistant', text, streaming: false, time })
      return
    }

    const streamed = this.items.slice(start)
    for (const item of streamed) {
      if (item.kind === 'reasoning' || item.kind === 'assistant') item.streaming = false
    }
    const reasoningItem = streamed.find(item => item.kind === 'reasoning')
    if (reasoningItem?.kind === 'reasoning') {
      reasoningItem.text = complete(reasoningItem.text, reasoning)
    } else if (reasoning !== '') {
      this.items.splice(start, 0, { kind: 'reasoning', text: reasoning, streaming: false, time })
    }

    const textItems = this.items.slice(start).filter(item => item.kind === 'assistant')
    const lastText = textItems.at(-1)
    if (lastText?.kind === 'assistant') {
      lastText.text = complete(lastText.text, text)
    } else if (text.trim() !== '') {
      this.items.push({ kind: 'assistant', text, streaming: false, time })
    }
  }
}
