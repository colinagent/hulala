import {
  applyConversationDelta,
  conversationBlockIndexSchema,
  conversationDeltaSchema,
  conversationItemSchema,
  type ConversationAssistantBlock,
  type ConversationContent,
  type ConversationDelta,
  type ConversationItem,
} from '@hulala/workbench-contracts'
import { isAppendSurfaceEvent, type SessionEvent } from '@deepseek-ai/dsh-session'
import { expandAssistantStream, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { SessionAssistantStreamBaseline, SessionAssistantStreamFrame } from '@deepseek-ai/dsh-api-session-controller/types'

export type HarnessEvent = {
  type: string
  seq: number
  time: number
  data: unknown
  sourceEventSeqs?: number[]
  surfaceOp?: 'append' | { op: 'replace'; start: number; end: number }
  ignorable?: true
}

export type HarnessHistoryEntry = { event: HarnessEvent; view?: unknown }

type MutableStream = {
  turn: number
  step: number
  blocks: Array<ConversationAssistantBlock | undefined>
  firstVisibleSeq?: number
  firstVisibleTime?: number
}

type ToolState = Extract<ConversationItem, { kind: 'tool' }>
type AssistantState = Extract<ConversationItem, { kind: 'assistant' }>

const QUIET_EVENT_TYPES = new Set([
  'turn/start',
  'step/start',
  'step/end',
  'request/context',
  'session/end-seed',
  'session/title',
  'session/title-llm-request',
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'permission/preset',
  'sandbox/mode',
  'agent-preset/selected',
  'agent/inbox/spliced',
  'compaction/start',
  'compaction/end',
  'compaction/prune',
  'feedback/record',
  'goal/change',
  'hook/invoked',
  'hook/result',
  'llm/retry-started',
  'plan/mode',
  'schedule/change',
  'subagent/descriptor',
  'team/member',
  'team/message/delivered',
  'team/message/queued',
  'team/task',
  'todo/write',
  'tool-workflow/agent-end',
  'tool-workflow/agent-start',
  'tool-workflow/run-end',
  'tool-workflow/run-start',
  'web/deepseek-search-llm-request',
])

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function coordinate(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function boundedText(value: unknown, maximum = 1_000_000): string {
  if (typeof value === 'string') return value.slice(0, maximum)
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value).slice(0, maximum)
  } catch {
    return String(value).slice(0, maximum)
  }
}

function imageContent(block: Record<string, unknown>): ConversationContent | null {
  const attachment = record(block.attachment)
  const mediaType = stringValue(attachment?.mediaType ?? block.mediaType)
  if (!mediaType || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) return null
  return {
    type: 'image',
    mediaType: mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
    ...(stringValue(attachment?.attachmentId ?? block.attachmentId) ? { attachmentId: stringValue(attachment?.attachmentId ?? block.attachmentId) } : {}),
    ...(stringValue(block.data) ? { data: stringValue(block.data) } : {}),
    ...(stringValue(attachment?.name ?? block.name) ? { name: stringValue(attachment?.name ?? block.name) } : {}),
    ...(numberValue(attachment?.width) ? { width: numberValue(attachment?.width) } : {}),
    ...(numberValue(attachment?.height) ? { height: numberValue(attachment?.height) } : {}),
    ...(numberValue(attachment?.bytes) ? { bytes: numberValue(attachment?.bytes) } : {}),
  }
}

export function normalizeConversationContent(message: Record<string, unknown> | null): ConversationContent[] {
  const blocks = Array.isArray(message?.content) ? message.content : []
  const content: ConversationContent[] = []
  for (const candidate of blocks) {
    const block = record(candidate)
    if (!block) continue
    if (block.type === 'text') content.push({ type: 'text', text: boundedText(block.text) })
    else if (block.type === 'image') {
      const image = imageContent(block)
      if (image) content.push(image)
    }
  }
  return content
}

function assistantBlock(candidate: unknown): ConversationAssistantBlock | null {
  const block = record(candidate)
  if (!block) return null
  if (block.type === 'text') return { type: 'text', text: boundedText(block.text) }
  if (block.type === 'reasoning') return { type: 'reasoning', text: boundedText(block.text) }
  if (block.type === 'image') return imageContent(block)
  if (block.type === 'tool-call') {
    return {
      type: 'tool-call',
      callId: stringValue(block.id ?? block.callId) ?? '',
      name: stringValue(block.name) ?? '',
      argumentsText: boundedText(block.arguments ?? block.argumentsText),
    }
  }
  return { type: 'unknown', value: block }
}

function normalizeAssistantBlocks(message: Record<string, unknown> | null): ConversationAssistantBlock[] {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks.flatMap(candidate => {
    const block = assistantBlock(candidate)
    return block === null ? [] : [block]
  })
}

function messageSourceLabel(message: Record<string, unknown> | null): string | undefined {
  const source = record(message?.source)
  if (!source || source.kind === 'user') return undefined
  return stringValue(source.name)
    ?? stringValue(source.plugin)
    ?? stringValue(source.kind)
}

function toolResultText(message: Record<string, unknown> | null): string {
  return normalizeConversationContent(message)
    .flatMap(part => part.type === 'text' ? [part.text] : [])
    .join('\n')
}

function resultCallId(message: Record<string, unknown> | null): string | undefined {
  return stringValue(message?.callId ?? message?.toolCallId)
}

function streamKey(data: Record<string, unknown>): string {
  return `${coordinate(data.turn)}:${coordinate(data.step)}`
}

function streamItemId(key: string): string {
  return `assistant:${key}`
}

function blockVisible(block: ConversationAssistantBlock | undefined): boolean {
  if (block === undefined || block.type === 'tool-call') return false
  if (block.type === 'text' || block.type === 'reasoning') return block.text.trim().length > 0
  if (block.type === 'unknown') return block.value !== null
  return true
}

function visibleBlocks(blocks: Array<ConversationAssistantBlock | undefined>): ConversationAssistantBlock[] {
  return blocks.filter((block): block is ConversationAssistantBlock => block !== undefined)
}

function emptyAssistantBlock(type: unknown): ConversationAssistantBlock {
  if (type === 'text') return { type: 'text', text: '' }
  if (type === 'reasoning') return { type: 'reasoning', text: '' }
  if (type === 'tool-call') return { type: 'tool-call', callId: '', name: '', argumentsText: '' }
  return { type: 'unknown', value: null }
}

function streamItem(
  key: string,
  stream: MutableStream,
  status: AssistantState['status'],
  fallback: { seq: number; time: number },
  messageId?: string,
): AssistantState {
  return {
    kind: 'assistant',
    id: streamItemId(key),
    seq: stream.firstVisibleSeq ?? fallback.seq,
    time: stream.firstVisibleTime ?? fallback.time,
    turn: stream.turn,
    step: stream.step,
    blocks: visibleBlocks(stream.blocks),
    status,
    ...(messageId ? { messageId } : {}),
  }
}

function isAppendOrigin(event: HarnessEvent): boolean {
  return isAppendSurfaceEvent(event as SessionEvent)
}

function turnEndNotice(event: HarnessEvent, data: Record<string, unknown>): ConversationItem | null {
  const reason = record(data.reason)
  const kind = stringValue(reason?.kind)
  if (!kind || kind === 'completed') return null
  const error = reason?.error
  return conversationItemSchema.parse({
    kind: 'notice',
    id: `turn-end:${event.seq}`,
    seq: event.seq,
    time: event.time,
    tone: kind === 'error' ? 'error' : 'warning',
    label: kind === 'max-tokens' ? 'Maximum context reached' : kind === 'aborted' ? 'Generation stopped' : 'Turn interrupted',
    ...(error !== undefined ? { detail: boundedText(record(error)?.message ?? error) } : {}),
    eventType: event.type,
  })
}

/**
 * Desktop read model over the stable Harness Session log. It preserves durable
 * Turn/Step coordinates and Assistant block order while projecting only
 * append-origin surface messages into the human transcript.
 */
export class HarnessConversationReadModel {
  private streamRevision = -1
  private activeAttempt?: { attemptId: string; turn: number; step: number; nextIndex: number; seq: number }
  private readonly streams = new Map<string, MutableStream>()
  private readonly tools = new Map<string, ToolState>()
  private readonly commands = new Map<string, Extract<ConversationItem, { kind: 'notice' }>>()
  private currentTurn: number | undefined
  private currentStep: number | undefined

  reset(): void {
    this.streamRevision = -1
    this.activeAttempt = undefined
    this.streams.clear()
    this.tools.clear()
    this.commands.clear()
    this.currentTurn = undefined
    this.currentStep = undefined
  }

  snapshot(entries: HarnessHistoryEntry[]): ConversationItem[] {
    this.reset()
    const items = new Map<string, ConversationItem>()
    for (const entry of entries) {
      for (const change of this.apply(entry.event, entry.view)) {
        applyConversationDelta(items, change)
      }
    }
    return [...items.values()].sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id))
  }

  restoreAssistantStream(baseline: SessionAssistantStreamBaseline): ConversationDelta[] {
    this.streamRevision = baseline.revision
    const active = baseline.activeAttempt
    if (!active) { this.activeAttempt = undefined; return [] }
    this.activeAttempt = { ...active, seq: active.startedAfterSeq + 1 }
    return expandAssistantStream(active.stream as unknown as AssistantStreamRecord[]).flatMap(({ time, chunk }) =>
      this.apply({ type: 'assistant/stream-chunk', seq: active.startedAfterSeq + 1, time,
        data: { turn: active.turn, step: active.step, chunk } }))
  }

  applyAssistantStream(frame: SessionAssistantStreamFrame): ConversationDelta[] {
    // A replacement Agent starts its own revision sequence at one.
    if (frame.type === 'start' && frame.revision === 1 && frame.attemptId !== this.activeAttempt?.attemptId) this.streamRevision = 0
    if (frame.revision <= this.streamRevision) return []
    this.streamRevision = frame.revision
    if (frame.type === 'start') {
      const previous = this.activeAttempt
      this.activeAttempt = { ...frame, nextIndex: 0, seq: frame.startedAfterSeq + 1 }
      if (!previous) return []
      const key = streamKey(previous)
      this.streams.delete(key)
      return [{ op: 'remove', id: streamItemId(key) }]
    }
    const active = this.activeAttempt
    if (!active || active.attemptId !== frame.attemptId) return []
    if (frame.index !== active.nextIndex) throw new Error('Harness assistant stream has a missing chunk')
    if (frame.type === 'chunk') {
      active.nextIndex += 1
      return this.apply({ type: 'assistant/stream-chunk', seq: active.seq, time: frame.time,
        data: { turn: active.turn, step: active.step, chunk: frame.chunk } })
    }
    this.activeAttempt = undefined
    if (frame.outcome.kind === 'committed') return []
    const key = streamKey(active)
    this.streams.delete(key)
    return [{ op: 'remove', id: streamItemId(key) }]
  }

  apply(event: HarnessEvent, view?: unknown): ConversationDelta[] {
    const data = record(event.data) ?? {}
    const changes: ConversationDelta[] = []
    if (event.type === 'turn/start') {
      this.currentTurn = coordinate(data.turn)
      this.currentStep = undefined
      return []
    }
    if (event.type === 'step/start') {
      this.currentTurn = coordinate(data.turn)
      this.currentStep = coordinate(data.step)
      return []
    }
    if (event.type === 'step/end') {
      this.currentStep = undefined
      return []
    }
    if (event.type === 'assistant/stream-chunk') {
      const chunk = record(data.chunk)
      if (!chunk) return []
      if (!['block-start', 'text-delta', 'reasoning-delta', 'tool-call-delta', 'block-end'].includes(String(chunk.type))) return []
      const parsedIndex = conversationBlockIndexSchema.safeParse(chunk.index)
      if (!parsedIndex.success) {
        return [{ op: 'upsert', item: {
          kind: 'notice', id: `invalid-block:${event.seq}`, seq: event.seq, time: event.time,
          tone: 'warning', label: 'Unable to display a response block',
          detail: 'The response block position is invalid or exceeds the display limit.', eventType: event.type,
        } }]
      }
      const key = streamKey(data)
      const state = this.streams.get(key) ?? {
        turn: coordinate(data.turn),
        step: coordinate(data.step),
        blocks: [],
      }
      const index = parsedIndex.data
      let projectedChunk: Extract<ConversationDelta, { op: 'assistant-chunk' }>['chunk'] | undefined
      if (chunk.type === 'block-start') state.blocks[index] = emptyAssistantBlock(chunk.blockType)
      else if (chunk.type === 'text-delta') {
        const previous = state.blocks[index]
        const text = boundedText(chunk.text)
        state.blocks[index] = {
          type: 'text',
          text: (previous?.type === 'text' ? previous.text : '') + text,
        }
        if (text) projectedChunk = { type: 'text-delta', text }
      } else if (chunk.type === 'reasoning-delta') {
        const previous = state.blocks[index]
        const text = boundedText(chunk.text)
        state.blocks[index] = {
          type: 'reasoning',
          text: (previous?.type === 'reasoning' ? previous.text : '') + text,
        }
        if (text) projectedChunk = { type: 'reasoning-delta', text }
      } else if (chunk.type === 'tool-call-delta') {
        const previous = state.blocks[index]
        const base = previous?.type === 'tool-call'
          ? previous
          : { type: 'tool-call' as const, callId: '', name: '', argumentsText: '' }
        state.blocks[index] = {
          type: 'tool-call',
          callId: base.callId || stringValue(chunk.id) || '',
          name: stringValue(chunk.name) ?? base.name,
          argumentsText: base.argumentsText + boundedText(chunk.argumentsDelta),
        }
      } else if (chunk.type === 'block-end') {
        const block = assistantBlock(chunk.block)
        if (block !== null) {
          state.blocks[index] = block
          if (blockVisible(block)) projectedChunk = { type: 'block-end', block }
        }
      }
      if (state.firstVisibleSeq === undefined && state.blocks.some(blockVisible)) {
        state.firstVisibleSeq = event.seq
        state.firstVisibleTime = event.time
      }
      this.streams.set(key, state)
      if (state.blocks.some(blockVisible) && projectedChunk !== undefined) {
        changes.push({
          op: 'assistant-chunk',
          id: streamItemId(key),
          anchorSeq: state.firstVisibleSeq ?? event.seq,
          anchorTime: state.firstVisibleTime ?? event.time,
          turn: state.turn,
          step: state.step,
          index,
          chunk: projectedChunk,
        })
      }
      return conversationDeltaSchema.array().parse(changes)
    }

    if (event.type === 'request/header') {
      const header = record(data.header)
      const system = stringValue(header?.system)
      if (system) changes.push({ op: 'upsert', item: {
        kind: 'message', id: `system-prompt:${event.seq}`, seq: event.seq, time: event.time,
        ...(this.currentTurn === undefined ? {} : { turn: this.currentTurn }),
        ...(this.currentStep === undefined ? {} : { step: this.currentStep }),
        role: 'system', sourceLabel: 'System prompt', content: [{ type: 'text', text: boundedText(system) }],
      } })
    } else if (event.type === 'user/message') {
      if (!isAppendOrigin(event)) return []
      const message = data
      const source = record(message.source)
      const role = source?.kind === 'user' ? 'user' : 'context'
      changes.push({ op: 'upsert', item: {
        kind: 'message', id: `message:${event.seq}`, seq: event.seq, time: event.time,
        ...(this.currentTurn === undefined ? {} : { turn: this.currentTurn }),
        ...(this.currentStep === undefined ? {} : { step: this.currentStep }),
        role, content: normalizeConversationContent(message), ...(messageSourceLabel(message) ? { sourceLabel: messageSourceLabel(message) } : {}),
      } })
    } else if (event.type === 'assistant/message') {
      if (!isAppendOrigin(event)) return []
      const message = record(data.message)
      const key = streamKey(data)
      const blocks = normalizeAssistantBlocks(message)
      const state = this.streams.get(key) ?? {
        turn: coordinate(data.turn),
        step: coordinate(data.step),
        blocks,
      }
      state.blocks = blocks
      if (state.firstVisibleSeq === undefined && state.blocks.some(blockVisible)) {
        state.firstVisibleSeq = event.seq
        state.firstVisibleTime = event.time
      }
      this.streams.delete(key)
      if (state.blocks.some(blockVisible)) {
        changes.push({
          op: 'upsert',
          item: streamItem(key, state, data.interrupted === true ? 'interrupted' : 'settled', event, stringValue(message?.id)),
        })
      } else if (state.firstVisibleSeq !== undefined) {
        // A final message is authoritative even when it retracts all visible
        // text. Otherwise the provisional bubble remains "running" forever.
        changes.push({ op: 'remove', id: streamItemId(key) })
      }
    } else if (event.type === 'tool/call') {
      const callId = stringValue(data.callId) ?? `call:${event.seq}`
      const item: ToolState = {
        kind: 'tool', id: `tool:${callId}`, seq: event.seq, time: event.time, callId,
        turn: coordinate(data.turn), step: coordinate(data.step),
        name: stringValue(data.name) ?? 'tool', status: 'running', argumentsText: boundedText(data.arguments),
        ...(view !== undefined ? { view } : {}),
      }
      this.tools.set(callId, item)
      changes.push({ op: 'upsert', item })
    } else if (event.type === 'tool/result') {
      if (!isAppendOrigin(event)) return []
      const message = record(data.message)
      const callId = resultCallId(message) ?? `call:${event.seq}`
      const previous = this.tools.get(callId)
      const item: ToolState = {
        kind: 'tool', id: `tool:${callId}`, seq: previous?.seq ?? event.seq, time: previous?.time ?? event.time,
        turn: previous?.turn ?? coordinate(data.turn), step: previous?.step ?? coordinate(data.step),
        callId, name: previous?.name ?? 'tool', argumentsText: previous?.argumentsText ?? '',
        status: message?.isError === true ? 'error' : 'done', resultText: toolResultText(message),
        ...(view !== undefined ? { view } : previous?.view !== undefined ? { view: previous.view } : {}),
      }
      this.tools.set(callId, item)
      changes.push({ op: 'upsert', item })
    } else if (event.type === 'tool/code-dispatch-start') {
      const callId = stringValue(data.subCallId) ?? `dispatch:${event.seq}`
      const item: ToolState = {
        kind: 'tool', id: `tool:${callId}`, seq: event.seq, time: event.time, callId,
        turn: coordinate(data.turn), step: coordinate(data.step),
        name: stringValue(data.name) ?? 'tool', status: 'running', argumentsText: boundedText(data.arguments),
      }
      this.tools.set(callId, item)
      changes.push({ op: 'upsert', item })
    } else if (event.type === 'tool/code-dispatch') {
      const callId = stringValue(data.subCallId) ?? `dispatch:${event.seq}`
      const previous = this.tools.get(callId)
      const content = Array.isArray(data.content)
        ? data.content.flatMap(candidate => record(candidate)?.type === 'text' ? [boundedText(record(candidate)?.text)] : []).join('\n')
        : boundedText(data.content)
      const item: ToolState = {
        kind: 'tool', id: `tool:${callId}`, seq: previous?.seq ?? event.seq, time: previous?.time ?? event.time,
        turn: previous?.turn ?? coordinate(data.turn), step: previous?.step ?? coordinate(data.step),
        callId, name: previous?.name ?? stringValue(data.name) ?? 'tool',
        status: data.isError === true ? 'error' : 'done',
        argumentsText: previous?.argumentsText ?? boundedText(data.arguments),
        resultText: content,
      }
      this.tools.set(callId, item)
      changes.push({ op: 'upsert', item })
    } else if (event.type === 'assistant/attempt') {
      const key = streamKey(data)
      if (this.streams.delete(key)) changes.push({ op: 'remove', id: streamItemId(key) })
    } else if (event.type === 'turn/end') {
      const turn = coordinate(data.turn)
      const reason = stringValue(record(data.reason)?.kind)
      if (reason && reason !== 'completed') {
        for (const [key, stream] of this.streams) {
          if (stream.turn !== turn) continue
          if (stream.blocks.some(blockVisible)) {
            changes.push({ op: 'upsert', item: streamItem(key, stream, 'interrupted', event) })
          }
          this.streams.delete(key)
        }
      }
      const notice = turnEndNotice(event, data)
      if (notice) changes.push({ op: 'upsert', item: notice })
      this.currentTurn = undefined
      this.currentStep = undefined
    } else if (event.type === 'llm/retry') {
      const key = streamKey(data)
      if (this.streams.delete(key)) changes.push({ op: 'remove', id: streamItemId(key) })
      changes.push({ op: 'upsert', item: {
        kind: 'notice', id: `retry:${event.seq}`, seq: event.seq, time: event.time,
        tone: 'warning', label: 'Retrying model request', detail: boundedText(data.error ?? data.failure ?? data), eventType: event.type,
      } })
    } else if (event.type === 'compaction/summary') {
      const summary = Array.isArray(data.summary)
        ? data.summary.flatMap(candidate => record(candidate)?.type === 'text' ? [boundedText(record(candidate)?.text)] : []).join('')
        : boundedText(data.summary)
      changes.push({ op: 'upsert', item: {
        kind: 'notice', id: `compaction:${event.seq}`, seq: event.seq, time: event.time,
        tone: 'neutral', label: 'Context compacted', detail: summary, eventType: event.type,
      } })
    } else if (event.type === 'command/run') {
      const commandId = stringValue(data.commandId) ?? String(event.seq)
      const item = conversationItemSchema.parse({
        kind: 'notice', id: `command:${commandId}`, seq: event.seq, time: event.time,
        tone: 'neutral', label: `/${stringValue(data.name) ?? 'command'}`,
        ...(data.args === undefined || data.args === null ? {} : { detail: boundedText(data.args) }),
        eventType: event.type,
      }) as Extract<ConversationItem, { kind: 'notice' }>
      this.commands.set(commandId, item)
      changes.push({ op: 'upsert', item })
    } else if (event.type === 'command/done') {
      const commandId = stringValue(data.commandId) ?? String(event.seq)
      const previous = this.commands.get(commandId)
      const outcome = stringValue(data.kind) ?? 'success'
      const item = conversationItemSchema.parse({
        kind: 'notice', id: `command:${commandId}`, seq: previous?.seq ?? event.seq, time: previous?.time ?? event.time,
        tone: outcome === 'error' ? 'error' : 'success', label: previous?.label ?? '/command',
        ...(data.text === undefined ? previous?.detail ? { detail: previous.detail } : {} : { detail: boundedText(data.text) }),
        eventType: event.type,
      }) as Extract<ConversationItem, { kind: 'notice' }>
      this.commands.set(commandId, item)
      changes.push({ op: 'upsert', item })
    } else if (!QUIET_EVENT_TYPES.has(event.type)) {
      changes.push({ op: 'upsert', item: {
        kind: 'notice', id: `event:${event.seq}`, seq: event.seq, time: event.time,
        tone: event.ignorable === true ? 'neutral' : 'warning',
        label: event.ignorable === true ? event.type : 'Unsupported Harness event',
        detail: event.ignorable === true ? undefined : `Update Hulala to render required event “${event.type}”.`,
        eventType: event.type,
      } })
    }
    return conversationDeltaSchema.array().parse(changes)
  }
}
