import {
  applyConversationDelta,
  conversationModelsSchema,
  conversationCommandSchema,
  conversationAgentPresetSelectionSchema,
  conversationOpenResultSchema,
  conversationSkillSchema,
  conversationSnapshotSchema,
  conversationSubagentSchema,
  pendingInteractionSchema,
  type ConversationIntent,
  type ConversationInteractionAnswer,
  type ConversationOpenResult,
  type ConversationPromptInput,
  type ConversationQueueItem,
  type ConversationQueueUpdateInput,
  type ConversationSession,
  type ConversationSnapshot,
  type PendingInteraction,
} from '@hulala/workbench-contracts'
import type { EventHub } from './events.ts'
import { HttpError } from './http.ts'
import {
  HarnessConversationReadModel,
  normalizeConversationContent,
  type HarnessEvent,
  type HarnessHistoryEntry,
} from './conversationReadModel.ts'
import type { HarnessApiAdapter, HarnessSessionSummary, HarnessWorkspace } from './runtime.ts'
import type { SessionAssistantStreamFrame } from '@deepseek-ai/dsh-api-session-controller/types'

type PendingRecord = {
  interaction: PendingInteraction
  rpcId: string
  approvalId?: string
}

type BufferedConversationEvent = {
  event: HarnessEvent
  view?: unknown
} | { frame: SessionAssistantStreamFrame }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function surfaceOperation(value: unknown): HarnessEvent['surfaceOp'] | undefined {
  if (value === 'append') return value
  const operation = asRecord(value)
  const start = numeric(operation?.start)
  const end = numeric(operation?.end)
  return operation?.op === 'replace'
    && start !== undefined && Number.isSafeInteger(start) && start >= 0
    && end !== undefined && Number.isSafeInteger(end) && end >= start
    ? { op: 'replace', start, end }
    : undefined
}

function sourceSequences(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const sequences = value.filter((candidate): candidate is number =>
    typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0)
  return sequences.length === value.length ? sequences : undefined
}

function sessionTitle(summary: HarnessSessionSummary): string {
  const title = summary.projections?.values.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  const titleRecord = asRecord(title)
  if (typeof titleRecord?.title === 'string' && titleRecord.title.trim()) return titleRecord.title.trim()
  return summary.blank ? 'New Chat' : summary.sessionId
}

function toConversationSession(
  summary: HarnessSessionSummary,
  workspaces: HarnessWorkspace[],
  archived: Set<string>,
): ConversationSession {
  const workspace = workspaces.find(candidate => candidate.sessionIds.includes(summary.sessionId))
  return {
    sessionId: summary.sessionId,
    ...(workspace ? { workspaceId: workspace.workspaceId } : {}),
    title: sessionTitle(summary),
    ...(summary.cwd ? { cwd: summary.cwd } : {}),
    updatedAt: summary.updatedAt,
    running: summary.running,
    blank: summary.blank,
    archived: archived.has(summary.sessionId),
    ...(summary.agentPreset ? { agentPreset: summary.agentPreset } : {}),
    ...(summary.parentSessionId ? { parentSessionId: summary.parentSessionId } : {}),
    ...(summary.origin ? { origin: summary.origin } : {}),
  }
}

function queueItems(payload: Record<string, unknown>): ConversationQueueItem[] {
  const rawItems = Array.isArray(payload.items) ? payload.items : []
  return rawItems.flatMap(candidate => {
    const item = asRecord(candidate)
    const message = asRecord(item?.message)
    const id = text(item?.id)
    const placement = item?.placement
    if (!id || (placement !== 'queued' && placement !== 'steering' && placement !== 'context')) return []
    return [{ id, placement, content: normalizeConversationContent(message) }]
  })
}

function workspaceOwnsSession(
  workspace: HarnessWorkspace,
  summaries: HarnessSessionSummary[],
  sessionId: string,
): boolean {
  const summariesById = new Map(summaries.map(summary => [summary.sessionId, summary]))
  const seen = new Set<string>()
  let candidateId: string | undefined = sessionId
  while (candidateId && !seen.has(candidateId)) {
    if (workspace.sessionIds.includes(candidateId)) return true
    seen.add(candidateId)
    candidateId = summariesById.get(candidateId)?.parentSessionId
  }
  return false
}

export class ConversationService {
  private readonly liveStatus = new Map<string, { running: boolean; blank?: boolean }>()
  private readonly promptRequests = new Map<string, { fingerprint: string; promise: Promise<unknown> }>()
  private readonly readModels = new Map<string, HarnessConversationReadModel>()
  private readonly queues = new Map<string, ConversationQueueItem[]>()
  private readonly projections = new Map<string, { asOfSeq: number; values: Record<string, unknown> }>()
  private readonly pending = new Map<string, PendingRecord>()
  private readonly pendingKeys = new Map<string, string>()
  private readonly lastSeq = new Map<string, number>()
  private readonly snapshotBuffers = new Map<string, BufferedConversationEvent[]>()
  private readonly snapshotLocks = new Map<string, Promise<void>>()
  private streamAbort?: AbortController
  private running = false
  private tasks: Promise<void>[] = []

  constructor(
    private readonly harness: HarnessApiAdapter,
    private readonly events: EventHub,
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.streamAbort = new AbortController()
    this.tasks = [this.pump('mux'), this.pump('host')]
  }

  async stop(): Promise<void> {
    this.running = false
    this.streamAbort?.abort()
    this.streamAbort = undefined
    await Promise.allSettled(this.tasks)
    this.tasks = []
  }

  async open(intent: ConversationIntent, workspacePath: string): Promise<ConversationOpenResult> {
    let sessionId: string
    let workspaceId: string | undefined
    if (intent.kind === 'workspace') {
      const opened = await this.harness.openWorkspaceSession(workspacePath, intent.preferredSessionId)
      sessionId = opened.sessionId
      workspaceId = opened.workspaceId
    } else {
      const [summaries, workspaceState] = await Promise.all([
        this.harness.listSessions(),
        this.harness.listWorkspaces(),
      ])
      const summary = summaries.find(candidate => candidate.sessionId === intent.sessionId)
      if (!summary) throw new HttpError(404, 'session_not_found', `Harness session not found: ${intent.sessionId}`)
      const workspace = workspaceState.items.find(candidate => candidate.path === workspacePath)
      if (!workspace) throw new HttpError(404, 'workspace_not_found', `Harness workspace not found: ${workspacePath}`)
      if (!workspaceOwnsSession(workspace, summaries, summary.sessionId)) {
        throw new HttpError(409, 'session_workspace_mismatch', 'conversation does not belong to the active workspace')
      }
      sessionId = summary.sessionId
      workspaceId = workspace.workspaceId
    }
    const [sessions, snapshot] = await Promise.all([
      this.list(workspaceId),
      this.snapshot(sessionId, { maxMessages: 400 }),
    ])
    return conversationOpenResultSchema.parse({
      ...(workspaceId ? { workspaceId } : snapshot.session.workspaceId ? { workspaceId: snapshot.session.workspaceId } : {}),
      sessionId,
      sessions,
      snapshot,
    })
  }

  async create(workspacePath: string, agentPreset?: string): Promise<ConversationOpenResult> {
    const workspace = await this.harness.createWorkspace(workspacePath)
    const created = await this.harness.createSession({
      workspaceId: workspace.workspace.workspaceId,
      ...(agentPreset ? { agentPreset } : {}),
    })
    return this.open({ kind: 'workspace', workspaceId: workspace.workspace.workspaceId, preferredSessionId: created.sessionId }, workspacePath)
  }

  async list(workspaceId?: string): Promise<ConversationSession[]> {
    const [summaries, workspaceState] = await Promise.all([
      this.harness.listSessions(),
      this.harness.listWorkspaces(),
    ])
    const archived = new Set(workspaceState.archivedSessionIds)
    const target = workspaceId ? workspaceState.items.find(item => item.workspaceId === workspaceId) : undefined
    if (workspaceId && !target) {
      throw new HttpError(404, 'workspace_not_found', `Harness workspace not found: ${workspaceId}`)
    }
    const visible = target
      ? summaries.filter(summary => target.sessionIds.includes(summary.sessionId))
      : summaries.filter(summary => summary.origin !== 'subagent')
    return visible
      .map(summary => toConversationSession(summary, workspaceState.items, archived))
      .sort((left, right) => right.updatedAt - left.updatedAt || left.sessionId.localeCompare(right.sessionId))
  }

  async listForPath(workspacePath: string): Promise<ConversationSession[]> {
    const workspaceState = await this.harness.listWorkspaces()
    const workspace = workspaceState.items.find(candidate => candidate.path === workspacePath)
    return workspace ? this.list(workspace.workspaceId) : []
  }

  location(sessionId: string) {
    return this.harness.sessionLocation(sessionId)
  }

  async snapshot(
    sessionId: string,
    input: { beforeSeq?: number; maxMessages?: number } = {},
  ): Promise<ConversationSnapshot> {
    return input.beforeSeq === undefined
      ? this.serializeSnapshot(sessionId, () => this.buildSnapshot(sessionId, input, true))
      : this.buildSnapshot(sessionId, input, false)
  }

  private async buildSnapshot(
    sessionId: string,
    input: { beforeSeq?: number; maxMessages?: number },
    latest: boolean,
  ): Promise<ConversationSnapshot> {
    const buffered: BufferedConversationEvent[] | undefined = latest ? [] : undefined
    if (buffered !== undefined) this.snapshotBuffers.set(sessionId, buffered)
    try {
      const [summaries, workspaceState] = await Promise.all([
        this.harness.listSessions(),
        this.harness.listWorkspaces(),
      ])
      const summary = summaries.find(candidate => candidate.sessionId === sessionId)
      if (!summary) throw new HttpError(404, 'session_not_found', `Harness session not found: ${sessionId}`)
      const address = await this.subagentAddress(summary)
      const history = address
        ? await this.harness.subagentHistory(address.parentSessionId, sessionId, address.mode, input)
        : await this.harness.history(sessionId, input)
      const archived = new Set(workspaceState.archivedSessionIds)
      const readModel = new HarnessConversationReadModel()
      const entries = history.events as HarnessHistoryEntry[]
      const projected = new Map(readModel.snapshot(entries).map(item => [item.id, item]))
      if (history.assistantStream) {
        for (const change of readModel.restoreAssistantStream(history.assistantStream)) applyConversationDelta(projected, change)
      }
      const firstSeq = entries[0]?.event.seq ?? null
      const historyLastSeq = entries.at(-1)?.event.seq ?? -1
      let lastSeq = historyLastSeq
      if (buffered !== undefined) {
        for (const entry of buffered) {
          if ('frame' in entry) {
            if (entry.frame.revision <= (history.assistantStream?.revision ?? -1)) continue
            for (const change of readModel.applyAssistantStream(entry.frame)) applyConversationDelta(projected, change)
            continue
          }
          if (entry.event.seq <= historyLastSeq) continue
          for (const change of readModel.apply(entry.event, entry.view)) {
            applyConversationDelta(projected, change)
          }
          lastSeq = Math.max(lastSeq, entry.event.seq)
        }
        this.readModels.set(sessionId, readModel)
        this.lastSeq.set(sessionId, Math.max(this.lastSeq.get(sessionId) ?? -1, lastSeq))
      }
      const baseline = history.projections
        ?? summary.projections
        ?? { asOfSeq: historyLastSeq, values: {} }
      const liveProjections = this.projections.get(sessionId)
      const projections = liveProjections && liveProjections.asOfSeq > baseline.asOfSeq
        ? {
          asOfSeq: liveProjections.asOfSeq,
          values: { ...baseline.values, ...liveProjections.values },
        }
        : baseline
      this.projections.set(sessionId, projections)
      return conversationSnapshotSchema.parse({
        transportCursor: this.events.cursor?.(),
        session: { ...toConversationSession(summary, workspaceState.items, archived), ...this.liveStatus.get(sessionId) },
        items: [...projected.values()].sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id)),
        hasMore: history.hasMore,
        firstSeq,
        lastSeq,
        queue: this.queues.get(sessionId) ?? [],
        pendingInteractions: [...this.pending.values()]
          .map(entry => entry.interaction)
          .filter(interaction => interaction.sessionId === sessionId),
        projections,
      })
    } finally {
      if (buffered !== undefined && this.snapshotBuffers.get(sessionId) === buffered) {
        this.snapshotBuffers.delete(sessionId)
      }
    }
  }

  private serializeSnapshot<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.snapshotLocks.get(sessionId) ?? Promise.resolve()
    const running = previous.catch(() => undefined).then(operation)
    const settled = running.then(() => undefined, () => undefined)
    this.snapshotLocks.set(sessionId, settled)
    void settled.finally(() => {
      if (this.snapshotLocks.get(sessionId) === settled) this.snapshotLocks.delete(sessionId)
    })
    return running
  }

  async prompt(sessionId: string, input: ConversationPromptInput): Promise<unknown> {
    if (input.requestId) {
      const key = sessionId + ':' + input.requestId
      const fingerprint = JSON.stringify([input.mode, input.content])
      const existing = this.promptRequests.get(key)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new HttpError(409, 'request_conflict', 'This request identity already belongs to a different message')
        return existing.promise
      }
      const promise = this.deliverPrompt(sessionId, input)
      this.promptRequests.set(key, { fingerprint, promise })
      try { return await promise } finally { this.promptRequests.delete(key) }
    }
    return this.deliverPrompt(sessionId, input)
  }

  private async deliverPrompt(sessionId: string, input: ConversationPromptInput): Promise<unknown> {
    const summary = (await this.harness.listSessions()).find(candidate => candidate.sessionId === sessionId)
    if (!summary) throw new HttpError(404, 'session_not_found', `Harness session not found: ${sessionId}`)
    const address = await this.subagentAddress(summary)
    return address
      ? this.harness.promptSubagent(address.parentSessionId, sessionId, input.content, input.clientTimeZone, input.requestId)
      : this.harness.prompt(sessionId, input)
  }

  async cancel(sessionId: string): Promise<unknown> {
    const summary = (await this.harness.listSessions()).find(candidate => candidate.sessionId === sessionId)
    if (!summary) throw new HttpError(404, 'session_not_found', `Harness session not found: ${sessionId}`)
    const address = await this.subagentAddress(summary)
    return address
      ? this.harness.interruptSubagent(address.parentSessionId, sessionId)
      : this.harness.cancelSession(sessionId)
  }

  fork(sessionId: string, atSeq?: number): Promise<{ sessionId: string }> {
    return this.harness.forkSession(sessionId, atSeq)
  }

  rename(sessionId: string, title: string): Promise<unknown> {
    return this.harness.renameSession(sessionId, title)
  }

  archive(sessionId: string): Promise<unknown> {
    return this.harness.archiveSession(sessionId)
  }

  models(sessionId: string): Promise<unknown> {
    return this.harness.models(sessionId).then(value => conversationModelsSchema.parse(value))
  }

  selectModel(sessionId: string, selection: { provider: string; model: string; reasoningEffort?: string }): Promise<unknown> {
    return this.harness.selectModel(sessionId, selection)
  }

  updateQueue(sessionId: string, itemId: string, action: ConversationQueueUpdateInput): Promise<unknown> {
    return this.harness.updateQueue(sessionId, itemId, action)
  }

  attachment(sessionId: string, attachmentId: string): Promise<unknown> {
    return this.harness.attachment(sessionId, attachmentId)
  }

  async skills(sessionId: string): Promise<unknown> {
    // Agent-scoped skill discovery requires the persisted Session to be resumed.
    // The command directory uses the shared Harness resolver and performs that
    // resume without adding a turn or changing the transcript.
    await this.harness.listCommands(sessionId).catch(() => [])
    const value = await this.harness.listSkills(sessionId)
    const items = Array.isArray(value) ? value : Array.isArray(asRecord(value)?.items) ? asRecord(value)?.items : []
    return { items: conversationSkillSchema.array().parse(items) }
  }

  async commands(sessionId: string): Promise<unknown> {
    const value = await this.harness.listCommands(sessionId)
    return { items: conversationCommandSchema.array().parse(Array.isArray(value) ? value : []) }
  }

  async executeCommand(
    sessionId: string,
    input: { line: string; images: Array<{ mediaType: string; uploadId: string; name?: string }> },
  ): Promise<unknown> {
    const command = await this.harness.executeCommand(sessionId, input.line, input.images)
    return command === undefined ? { matched: false } : { matched: true, command }
  }

  agentPresets(): Promise<unknown> {
    return this.harness.listAgentPresets()
  }

  async selectAgentPreset(sessionId: string, agentPreset: string): Promise<{ agentPreset: string }> {
    const value = conversationAgentPresetSelectionSchema.parse(
      await this.harness.selectAgentPreset(sessionId, agentPreset),
    )
    this.events.emit({ type: 'conversation.sessionsChanged', sessionId })
    return value
  }

  async subagents(parentSessionId: string): Promise<unknown> {
    const value = await this.harness.listSubagents(parentSessionId)
    const source = asRecord(value)
    return {
      entries: conversationSubagentSchema.array().parse(Array.isArray(source?.entries) ? source.entries : []),
      parentAvailable: source?.parentAvailable === true,
    }
  }

  async answer(interactionId: string, answer: ConversationInteractionAnswer): Promise<{ accepted: boolean }> {
    const pending = this.pending.get(interactionId)
    if (!pending) throw new HttpError(409, 'interaction_not_pending', 'interaction is no longer pending')
    if (pending.interaction.kind === 'approval') {
      if (answer.kind !== 'approval') throw new HttpError(400, 'interaction_answer_invalid', 'approval outcome is required')
      const receipt = await this.harness.respond(pending.rpcId, {
        ok: true,
        value: {
          sessionId: pending.interaction.sessionId,
          approvalId: pending.approvalId,
          outcome: answer.outcome,
        },
      })
      if (!receipt.accepted) throw new HttpError(409, 'interaction_not_pending', receipt.reason ?? 'interaction is no longer pending')
      return { accepted: true }
    }
    const result = answer.kind === 'question'
      ? { ok: true as const, value: { sessionId: pending.interaction.sessionId, answer: answer.answer } }
      : answer.kind === 'cancel'
        ? { ok: false as const, error: { code: 'cancelled', message: 'the user closed this question request', details: {} } }
        : null
    if (!result) throw new HttpError(400, 'interaction_answer_invalid', 'question answer is required')
    const receipt = await this.harness.respond(pending.rpcId, result)
    if (!receipt.accepted) throw new HttpError(409, 'interaction_not_pending', receipt.reason ?? 'interaction is no longer pending')
    return { accepted: true }
  }

  private readModel(sessionId: string): HarnessConversationReadModel {
    const existing = this.readModels.get(sessionId)
    if (existing) return existing
    const created = new HarnessConversationReadModel()
    this.readModels.set(sessionId, created)
    return created
  }

  private async subagentAddress(summary: HarnessSessionSummary): Promise<{ parentSessionId: string; mode: 'one-shot' | 'continuable' } | null> {
    if (summary.origin !== 'subagent' || !summary.parentSessionId) return null
    const catalog = asRecord(await this.harness.listSubagents(summary.parentSessionId))
    const entries = Array.isArray(catalog?.entries) ? catalog.entries : []
    const child = entries.map(asRecord).find(candidate => candidate?.kind === 'child' && candidate.id === summary.sessionId)
    const mode = child?.mode
    if (mode !== 'one-shot' && mode !== 'continuable') {
      throw new HttpError(409, 'subagent_not_resumable', `Harness subagent is unavailable: ${summary.sessionId}`)
    }
    return { parentSessionId: summary.parentSessionId, mode }
  }

  private async pump(kind: 'mux' | 'host'): Promise<void> {
    let delay = 100
    let connectedBefore = false
    while (this.running) {
      let opened = false
      let openedAt = 0
      try {
        const signal = this.streamAbort?.signal
        if (signal === undefined) return
        const stream = this.harness.events(kind, signal, () => {
          opened = true
          openedAt = Date.now()
          this.events.emit({ type: 'conversation.reset', reason: connectedBefore ? 'reconnected' : 'connected' })
          connectedBefore = true
        })
        for await (const envelope of stream) {
          if (kind === 'mux') this.handleMux(envelope.rpcId, envelope.payload)
          else this.handleHost(envelope.payload)
        }
      } catch {
        // Runtime may still be restarting. The bounded backoff below reconnects.
      }
      if (!this.running || this.streamAbort?.signal.aborted === true) break
      if (kind === 'mux') this.clearPending()
      if (opened && Date.now() - openedAt >= 10_000) delay = 100
      await Bun.sleep(delay)
      delay = Math.min(delay * 2, 2_000)
    }
  }

  private handleMux(rpcId: string, payload: Record<string, unknown>): void {
    const type = payload.type
    const sessionId = text(payload.sessionId)
    if (type === 'stream/error') {
      this.events.emit({ type: 'conversation.reset', reason: 'stream-error' })
      return
    }
    if (!sessionId) return
    if (type === 'session/assistant-stream') {
      const frame = payload.frame as SessionAssistantStreamFrame
      this.snapshotBuffers.get(sessionId)?.push({ frame })
      const changes = this.readModel(sessionId).applyAssistantStream(frame)
      if (changes.length) this.events.emit({ type: 'conversation.delta', sessionId, seq: this.lastSeq.get(sessionId) ?? 0, transient: true, changes })
      return
    }
    if (type === 'session/subscribed') {
      const seq = numeric(payload.lastSeq)
      if (seq !== undefined) this.lastSeq.set(sessionId, Math.max(this.lastSeq.get(sessionId) ?? -1, seq))
      return
    }
    if (type === 'session/event') {
      const event = asRecord(payload.event)
      const seq = numeric(event?.seq)
      const time = numeric(event?.time)
      const eventType = text(event?.type)
      if (seq === undefined || time === undefined || !eventType || event?.data === undefined) return
      const previous = this.lastSeq.get(sessionId)
      if (previous !== undefined && seq > previous + 1) {
        this.events.emit({ type: 'conversation.reset', sessionId, reason: 'gap' })
      }
      if (previous !== undefined && seq <= previous) return
      this.lastSeq.set(sessionId, seq)
      const sourceEventSeqs = sourceSequences(event.sourceEventSeqs)
      const surfaceOp = surfaceOperation(event.surfaceOp)
      const normalized: HarnessEvent = {
        type: eventType,
        seq,
        time,
        data: event.data,
        ...(sourceEventSeqs ? { sourceEventSeqs } : {}),
        ...(surfaceOp ? { surfaceOp } : {}),
        ...(event.ignorable === true ? { ignorable: true } : {}),
      }
      this.snapshotBuffers.get(sessionId)?.push({
        event: normalized,
        ...(payload.view === undefined ? {} : { view: payload.view }),
      })
      if (eventType === 'session/title') this.events.emit({ type: 'conversation.sessionsChanged', sessionId })
      if (eventType === 'user/message') {
        this.liveStatus.set(sessionId, { running: true, blank: false })
        this.events.emit({ type: 'conversation.status', sessionId, running: true, blank: false })
      }
      const changes = this.readModel(sessionId).apply(normalized, payload.view)
      if (eventType === 'turn/end') {
        const kind = text(asRecord(asRecord(event.data)?.reason)?.kind)
        this.events.emit({ type: 'conversation.turnEnded', sessionId, outcome: kind === 'completed' ? 'completed' : kind === 'error' ? 'failed' : kind === 'blocked' ? 'blocked' : 'stopped' })
      }
      if (changes.length > 0) this.events.emit({ type: 'conversation.delta', sessionId, seq, changes })
      return
    }
    if (type === 'session/queue') {
      const items = queueItems(payload)
      this.queues.set(sessionId, items)
      this.events.emit({ type: 'conversation.queue', sessionId, items })
      return
    }
    if (type === 'session/projection') {
      const key = text(payload.key)
      const seq = numeric(payload.seq)
      if (!key || seq === undefined) return
      const current = this.projections.get(sessionId) ?? { asOfSeq: -1, values: {} }
      const next = { asOfSeq: Math.max(current.asOfSeq, seq), values: { ...current.values, [key]: payload.value } }
      this.projections.set(sessionId, next)
      this.events.emit({ type: 'conversation.projection', sessionId, key, value: payload.value, seq })
      return
    }
    if (type === 'session/jobs') {
      this.events.emit({ type: 'conversation.projection', sessionId, key: 'jobs', value: payload.jobs, seq: this.lastSeq.get(sessionId) ?? 0 })
      return
    }
    if (type === 'approval/requested') {
      const approvalId = text(payload.approvalId)
      if (!approvalId) return
      const stableKey = `approval:${sessionId}:${approvalId}`
      const interactionId = this.pendingKeys.get(stableKey) ?? crypto.randomUUID()
      const interaction = pendingInteractionSchema.parse({
        kind: 'approval', interactionId, sessionId,
        toolName: text(payload.toolName) ?? 'tool',
        ...(text(payload.callId) ? { callId: text(payload.callId) } : {}),
        ...(text(payload.reason) ? { reason: text(payload.reason) } : {}),
      })
      this.pendingKeys.set(stableKey, interactionId)
      this.pending.set(interactionId, { interaction, rpcId, approvalId })
      this.events.emit({ type: 'conversation.interaction', sessionId, interaction })
      return
    }
    if (type === 'question/requested') {
      const stableKey = `question:${sessionId}:${rpcId}`
      const interactionId = this.pendingKeys.get(stableKey) ?? crypto.randomUUID()
      const interaction = pendingInteractionSchema.parse({
        kind: 'question', interactionId, sessionId, questions: payload.questions,
      })
      this.pendingKeys.set(stableKey, interactionId)
      this.pending.set(interactionId, { interaction, rpcId })
      this.events.emit({ type: 'conversation.interaction', sessionId, interaction })
      return
    }
    if (type === 'approval/resolved' || type === 'question/resolved') {
      const match = [...this.pending.entries()].find(([, entry]) => type === 'approval/resolved'
        ? entry.approvalId === payload.approvalId
        : entry.rpcId === payload.questionRpcId)
      if (!match) return
      this.pending.delete(match[0])
      this.events.emit({ type: 'conversation.interaction', sessionId, interaction: null, resolvedInteractionId: match[0] })
    }
  }

  private handleHost(payload: Record<string, unknown>): void {
    const type = payload.type
    const sessionId = text(payload.sessionId)
    if (type === 'host/session-status' && sessionId) {
      this.liveStatus.set(sessionId, { ...this.liveStatus.get(sessionId), running: payload.running === true })
      this.events.emit({ type: 'conversation.status', sessionId, running: payload.running === true })
      return
    }
    if (type === 'host/session-added' && sessionId) {
      this.liveStatus.set(sessionId, { running: false, blank: payload.blank === true })
      this.events.emit({ type: 'conversation.status', sessionId, running: false, blank: payload.blank === true })
      this.events.emit({ type: 'conversation.sessionsChanged', sessionId })
      return
    }
    if (type === 'host/session-removed' && sessionId) {
      this.liveStatus.delete(sessionId)
      this.readModels.delete(sessionId)
      this.queues.delete(sessionId)
      this.projections.delete(sessionId)
      this.lastSeq.delete(sessionId)
      this.events.emit({ type: 'conversation.sessionsChanged', sessionId })
      return
    }
    if (type === 'host/agent-error' && sessionId) {
      const seq = (this.lastSeq.get(sessionId) ?? -1) + 1
      this.events.emit({
        type: 'conversation.delta', sessionId, seq,
        changes: [{ op: 'upsert', item: {
          kind: 'notice', id: `agent-error:${seq}`, seq, time: Date.now(), tone: 'error',
          label: 'Agent error', detail: text(payload.message) ?? 'Unknown Harness error', eventType: String(type),
        } }],
      })
      return
    }
    if (type === 'host/workspace-changed'
      || type === 'host/session-activity'
      || type === 'host/workspace-removed'
      || type === 'host/workspace-order-changed'
      || type === 'host/archived-sessions-changed') {
      this.events.emit({ type: 'conversation.sessionsChanged' })
    }
  }

  private clearPending(): void {
    const sessions = new Set([...this.pending.values()].map(item => item.interaction.sessionId))
    this.pending.clear()
    this.pendingKeys.clear()
    for (const sessionId of sessions) this.events.emit({ type: 'conversation.interaction', sessionId, interaction: null })
  }
}
