import type {
  ConversationContent,
  ConversationModelSelectionInput,
  ConversationPromptInput,
  ConversationQueueUpdateInput,
  ConversationSessionLocation,
} from '@hulala/workbench-contracts'
import type { AuthorizationService } from '@deepseek-ai/dsh-authorization'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SessionId, type SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import type { SessionAddress, SessionFollowFrame, SessionPage, ModelCatalog } from '@deepseek-ai/dsh-api-session-controller'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { AgentPresets } from '@deepseek-ai/dsh-agent-presets'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { dirname } from 'node:path'
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model'
import type { SessionAssistantStreamBaseline } from '@deepseek-ai/dsh-api-session-controller/types'
import type { EventHub } from './events.ts'
import { HttpError } from './http.ts'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ConversationUploads } from './conversationUploads'

export type RuntimeState = 'disabled' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

export interface HarnessInProcessServices {
  agents?: AgentRegistry
  agentPresets?: AgentPresets
  settings?: SettingsProvider
  agentDefaultModel?: AgentDefaultModelConfig
  llm?: LlmRuntime
  attachments?: AttachmentStore
  conversationUploads?: ConversationUploads
  localPlugins?: import('./localPlugins/manager.ts').LocalPluginManager
  typertGateway?: Pick<TypertGateway, 'invoke' | 'stream'>
  notifications?: HarnessNotifications
  agentLoopSelector?: {
    describe?(sessionId?: string): Promise<unknown>
    select?(input: Record<string, unknown>): Promise<unknown>
  }
  authorization?: AuthorizationService
  credentials?: CredentialProvider
  sessions?: SessionStore
  sessionPersistence?: SessionPersistence
  workspaceRegistry?: import('./workspaces.ts').NativeWorkspaceRegistry
  fs?: import('@deepseek-ai/dsh-fs').FileSystem
  subprocess?: import('@deepseek-ai/dsh-subprocess').SubprocessRuntime
  productDatabase?: import('./database.ts').ServerDatabase
}

export interface HarnessStreamEnvelope {
  rpcId: string
  payload: Record<string, unknown>
}

/** Private presentation events and answers over the live Cordis services. */
export interface HarnessNotifications {
  events(kind: 'mux' | 'host', signal: AbortSignal, onOpen: () => void): AsyncIterable<HarnessStreamEnvelope>
  respond(id: string, result: HarnessInteractionResult<unknown>): Promise<{ accepted: boolean; reason?: string }>
}

export class HarnessEndpointState {
  private currentState: RuntimeState
  private currentError?: string

  constructor(
    private readonly events: EventHub,
    private readonly available = false,
  ) {
    this.currentState = available ? 'starting' : 'disabled'
  }

  status(): { state: RuntimeState; error?: string } {
    return { state: this.currentState, error: this.currentError }
  }

  async start(): Promise<void> {
    if (this.currentState === 'disabled' || this.currentState === 'running') return
    this.setState('starting')
    this.setState('running')
  }

  async stop(): Promise<void> {
    if (this.currentState !== 'disabled') this.setState('stopped')
  }

  private setState(state: RuntimeState, error?: unknown): void {
    this.currentState = state
    this.currentError = error === undefined ? undefined : error instanceof Error ? error.message : String(error)
    this.events.emit({ type: 'runtime.changed', state: this.status() })
  }

}

export type HarnessInteractionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }

export type HarnessSessionSummary = {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
  agentPreset?: string
  projections?: { asOfSeq: number; values: Record<string, unknown> }
}

export type HarnessWorkspace = {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
  createdAt: string
  updatedAt: string
}

export type HarnessEventEnvelope = {
  type: string
  seq: number
  time: number
  data: unknown
  sourceEventSeqs?: number[]
  surfaceOp?: unknown
  ignorable?: true
}

export type HarnessHistoryEntry = { event: HarnessEventEnvelope; view?: unknown }

export type HarnessHistory = {
  events: HarnessHistoryEntry[]
  hasMore: boolean
  assistantStream?: SessionAssistantStreamBaseline
  projections?: { asOfSeq: number; values: Record<string, unknown> }
}

export type OpenAICodexProviderState = {
  active: boolean
  profileConfigured: boolean
  apiKeyOverride: boolean
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const part of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export class HarnessApiAdapter {
  constructor(private readonly services: HarnessInProcessServices = {}) {}

  private gateway(): NonNullable<HarnessInProcessServices['typertGateway']> {
    if (!this.services.typertGateway) throw new HttpError(503, 'runtime_unavailable', 'Harness Runtime is unavailable')
    return this.services.typertGateway
  }

  private async call<T>(endpoint: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const [namespace, method] = endpoint.split('/')
    try {
      return await this.gateway().invoke({ namespace: namespace!, method: method!, args: cleanArguments(args), signal }) as T
    } catch (error) {
      if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
        throw new HttpError(409, error.code, error.message, 'details' in error ? error.details : undefined)
      }
      throw error
    }
  }

  private async firstFrame<T>(endpoint: string, args: Record<string, unknown>): Promise<T> {
    const abort = new AbortController()
    const [namespace, method] = endpoint.split('/')
    try {
      const stream = await this.gateway().stream({ namespace: namespace!, method: method!, args: cleanArguments(args), signal: abort.signal })
      for await (const frame of stream) return frame as T
      throw new HttpError(503, 'runtime_stream_empty', 'Harness stream ended before its opening snapshot')
    } finally { abort.abort() }
  }

  private async readHistory(address: SessionAddress, input: { beforeSeq?: number; maxMessages?: number }): Promise<HarnessHistory> {
    const opening = await this.firstFrame<Extract<SessionFollowFrame, { type: 'snapshot' }>>('session/follow', { request: { address, maxMessages: input.maxMessages, assistantStream: true } })
    const page = input.beforeSeq === undefined ? opening : await this.call<SessionPage>('session/page', { request: { address, throughSeq: opening.cursor, ...input } })
    return {
      events: page.records.map(({ event }) => ({ event: {
        ...event,
        sourceEventSeqs: Array.isArray(event.sourceEventSeqs)
          ? event.sourceEventSeqs.filter((seq): seq is number => typeof seq === 'number') : undefined,
        ignorable: event.ignorable === true ? true : undefined,
      } })),
      hasMore: page.hasMore,
      ...(input.beforeSeq === undefined ? { assistantStream: opening.assistantStream } : {}),
      projections: opening.projections as HarnessHistory['projections'],
    }
  }

  async runtimeState(sessionId?: string): Promise<unknown> {
    if (this.services.agentLoopSelector?.describe !== undefined) {
      return this.services.agentLoopSelector.describe(sessionId)
    }
    throw new HttpError(503, 'runtime_unavailable', 'Harness Runtime selector is unavailable')
  }

  async selectRuntime(input: Record<string, unknown>): Promise<unknown> {
    if (this.services.agentLoopSelector?.select !== undefined) {
      return this.services.agentLoopSelector.select(input)
    }
    throw new HttpError(503, 'runtime_unavailable', 'Harness Runtime selector is unavailable')
  }

  settingsDescribe(): Promise<unknown> { return this.call('settings/describe') }
  settingsMutate(payload: Record<string, unknown>): Promise<unknown> { return this.call('settings/mutate', payload) }
  async settingsOpenDocument(): Promise<{ path: string; directory: string }> {
    const path = await this.services.settings?.prepareDocument()
    if (!path) throw new HttpError(409, 'settings_document_unavailable', 'This settings provider has no local document')
    return { path, directory: dirname(path) }
  }
  llmProviders(): Promise<unknown> { return this.call<unknown[]>('llm/listConfigurableProviders').then(providers => ({ providers })) }
  llmDiscoverModels(payload: Record<string, unknown>): Promise<unknown> { const { settingsNs, ...request } = payload; return this.call('llm/discoverModels', { settingsNs, request }).then(models => ({ models })) }
  credentialsDescribe(payload: Record<string, unknown>): Promise<unknown> { return this.call('credentials/describe', payload).then(credentials => ({ credentials })) }
  credentialsSet(payload: Record<string, unknown>): Promise<unknown> { return this.call('credentials/set', payload).then(() => ({ configured: true })) }
  credentialsUnset(payload: Record<string, unknown>): Promise<unknown> { return this.call('credentials/unset', payload).then(() => ({ configured: false })) }

  async openAICodexProviderState(): Promise<OpenAICodexProviderState> {
    const [description, directory] = await Promise.all([
      this.settingsDescribe() as Promise<{
        namespaces?: Array<{ ns?: unknown; value?: unknown; user?: unknown }>
      }>,
      this.llmProviders() as Promise<{
        providers?: Array<{ provider?: unknown; active?: unknown }>
      }>,
    ])
    const namespace = description.namespaces?.find(candidate => candidate.ns === 'llm-pi-ai')
    const profilePath = ['providers', 'openai-codex'] as const
    const resolvedProfile = valueAtPath(namespace?.value, profilePath)
    const userProfile = valueAtPath(namespace?.user, profilePath)
    const apiKeyEnv = valueAtPath(namespace?.value, [...profilePath, 'apiKeyEnv'])
    const provider = directory.providers?.find(candidate => candidate.provider === 'openai-codex')
    return {
      active: provider?.active === true,
      profileConfigured: userProfile !== undefined || resolvedProfile !== undefined,
      apiKeyOverride: typeof apiKeyEnv === 'string' && apiKeyEnv.trim().length > 0,
    }
  }

  async enableOpenAICodexAccount(): Promise<OpenAICodexProviderState> {
    const profilePath = ['providers', 'openai-codex'] as const
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const description = await this.settingsDescribe() as {
        namespaces?: Array<{ ns?: unknown; value?: unknown; user?: unknown; revision?: unknown }>
      }
      const namespace = description.namespaces?.find(candidate => candidate.ns === 'llm-pi-ai')
      if (namespace === undefined || typeof namespace.revision !== 'number') {
        throw new HttpError(409, 'provider_settings_unavailable', 'OpenAI Codex provider settings are unavailable')
      }
      const userProfile = valueAtPath(namespace.user, profilePath)
      const apiKeyEnv = valueAtPath(namespace.value, [...profilePath, 'apiKeyEnv'])
      const ops: Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }> = []
      if (userProfile === undefined) {
        ops.push({ op: 'set', path: [...profilePath], value: {} })
      } else if (typeof apiKeyEnv === 'string' && apiKeyEnv.trim().length > 0) {
        ops.push({ op: 'unset', path: [...profilePath, 'apiKeyEnv'] })
      }
      if (ops.length > 0) {
        try {
          await this.settingsMutate({ ns: 'llm-pi-ai', ops, expectedRevision: namespace.revision })
        } catch (error) {
          if (error instanceof HttpError && error.code === 'settings/conflict' && attempt < 2) continue
          throw error
        }
      }
      const state = await this.openAICodexProviderState()
      if (state.active && !state.apiKeyOverride) return state
      if (attempt === 2) break
    }
    throw new HttpError(409, 'provider_activation_failed', 'OpenAI Codex provider could not be activated for account authentication')
  }
  async agentPresetList(): Promise<unknown> {
    const roster = await this.call<Record<string, unknown>>('agentPresets/list')
    return { ...roster, hasDocument: Boolean(this.services.agentPresets) }
  }
  agentPresetRead(payload: Record<string, unknown>): Promise<unknown> { return this.call('agentPresets/read', payload) }
  agentPresetCopy(payload: Record<string, unknown>): Promise<unknown> { const { agentPreset: id, ...rest } = payload; return this.call('agentPresets/copy', { ...rest, id }).then(() => ({ agentPreset: id })) }
  async agentPresetOpenDocument(payload: Record<string, unknown>): Promise<{ path: string; directory: string }> {
    if (typeof payload.agentPreset !== 'string' || !payload.agentPreset.trim()) throw new HttpError(400, 'invalid_agent_preset', 'An Agent preset is required')
    if (!this.services.agentPresets) throw new HttpError(503, 'runtime_unavailable', 'Agent presets are unavailable')
    const preset = await this.services.agentPresets.resolve(payload.agentPreset)
    if (preset.trust !== 'user') throw new HttpError(403, 'agent_preset_read_only', 'Built-in Agent presets are read-only; copy the preset before editing it')
    return { path: preset.path, directory: dirname(preset.path) }
  }
  agentPresetRemove(payload: Record<string, unknown>): Promise<unknown> { return this.call('agentPresets/deletePreset', { id: payload.agentPreset }).then(() => ({ removed: true })) }
  pluginInventory(): Promise<unknown> { return this.call('pluginInventory/list') }

  async listSessions(): Promise<HarnessSessionSummary[]> {
    return (await this.call<{ items: HarnessSessionSummary[] }>('session/list', { _request: {} })).items
  }

  async sessionLocation(sessionId: string): Promise<ConversationSessionLocation> {
    const persistence = this.services.sessionPersistence
    if (persistence === undefined) {
      throw new HttpError(503, 'session_location_unavailable', 'Harness session artifact locations are unavailable')
    }
    const id = SessionId(sessionId)
    const header = this.services.sessions?.get(id)?.header ?? (await persistence.stat(id))?.header
    if (header === undefined) {
      throw new HttpError(404, 'session_not_found', `Harness session not found: ${sessionId}`)
    }
    const backend = persistence as SessionPersistence & {
      resolveCurrentLog?: (id: ReturnType<typeof SessionId>) => Promise<string | undefined>
    }
    if (typeof backend.resolveCurrentLog !== 'function') {
      throw new HttpError(409, 'session_location_unsupported', 'The active Harness persistence backend has no per-session artifact path')
    }
    await persistence.flush()
    const path = await backend.resolveCurrentLog(id)
    if (path === undefined) {
      throw new HttpError(409, 'session_location_unavailable', 'The current Harness session artifact has not materialized')
    }
    return { sessionId, kind: 'jsonl', path }
  }

  async listWorkspaces(): Promise<{ items: HarnessWorkspace[]; archivedSessionIds: string[] }> {
    return this.firstFrame<{ type: 'baseline'; value: { items: HarnessWorkspace[]; archivedSessionIds: string[] } }>('workspace/follow', {}).then(frame => frame.value)
  }

  async createWorkspace(path: string): Promise<{ workspace: HarnessWorkspace; created: boolean }> {
    return this.call('workspace/create', { request: { path } })
  }

  async archiveSession(sessionId: string): Promise<{ archivedSessionIds: string[] }> {
    return this.call('workspace/archiveSession', { request: { sessionId } })
  }

  async createSession(input: { workspaceId?: string; cwd?: string; agentPreset?: string }): Promise<{ sessionId: string; agentPreset?: string }> {
    if (input.workspaceId && input.cwd) {
      const workspace = this.services.workspaceRegistry?.get(input.workspaceId) as { path: string; attachSession?: (sessionId: ReturnType<typeof SessionId>) => Promise<void> } | undefined
      if (!workspace) throw new HttpError(404, 'workspace_not_found', 'Workspace not found')
      if (workspace.path === input.cwd) return this.createSession({ workspaceId: input.workspaceId, agentPreset: input.agentPreset })
      if (!workspace.attachSession) throw new HttpError(503, 'workspace_attach_unavailable', 'This Runtime cannot attach a task with a custom working directory')
      const created = await this.createSession({ cwd: input.cwd, agentPreset: input.agentPreset })
      await workspace.attachSession(SessionId(created.sessionId))
      return created
    }
    return this.call('session/create', { request: input })
  }

  async history(sessionId: string, input: { beforeSeq?: number; maxMessages?: number } = {}): Promise<HarnessHistory> {
    return this.readHistory({ kind: 'session', sessionId: SessionId(sessionId) }, input)
  }

  async models(sessionId: string): Promise<{
    current: { provider: string; model: string; reasoningEffort?: string }
    routable: boolean
    groups: unknown[]
    failures: unknown[]
  }> {
    const [catalog, listing] = await Promise.all([this.call<ModelCatalog>('session/modelCatalog'), this.listSessions()])
    const projection = listing.find(item => item.sessionId === sessionId)?.projections?.values.modelSelection as { next?: ModelCatalog['default'] } | undefined
    return { current: projection?.next ?? catalog.default, routable: catalog.routableProviders.length > 0, groups: [...catalog.groups], failures: [...catalog.failures] }
  }

  async selectModel(sessionId: string, selection: ConversationModelSelectionInput): Promise<unknown> {
    return this.call('session/selectModel', { request: { sessionId, ...selection } })
  }

  /** A task gets an ordinary native Agent, with its own creation-time model. */
  async createTaskSession(input: { workspaceId: string; cwd: string; modelKey?: string }): Promise<{ sessionId: string }> {
    const { agents, agentPresets, agentDefaultModel, llm } = this.services
    if (!agents || !llm || !agentDefaultModel) throw new HttpError(503, 'task_runtime_unavailable', 'Task Agent creation is unavailable')
    const workspace = this.services.workspaceRegistry?.get(input.workspaceId) as { attachSession?: (sessionId: ReturnType<typeof SessionId>) => Promise<void> } | undefined
    if (!workspace?.attachSession) throw new HttpError(503, 'workspace_attach_unavailable', 'Task Workspace attachment is unavailable')
    const colon = input.modelKey?.indexOf(':') ?? -1
    const requested = input.modelKey ? { provider: input.modelKey.slice(0, colon), model: input.modelKey.slice(colon + 1) } : agentDefaultModel.currentSelection()
    const resolved = await llm.resolveCallConfig(requested)
    const selection = { provider: resolved.provider, model: resolved.model, ...(resolved.reasoningEffort ? { reasoningEffort: resolved.reasoningEffort } : {}) }
    const preset = await agentPresets?.resolve()
    const sessionId = SessionId('session-' + crypto.randomUUID())
    const handle = await agents.create({ sessionId, meta: { cwd: input.cwd, ...(preset ? { agentPreset: preset.id } : {}) }, agentOptions: selection,
      setup: async (agentCtx, agent) => {
        // Seed the native projection before publication, so API Session picks
        // this route without writing the default for future conversations.
        agent.session.append('model/selection', selection)
        if (preset) await agentPresets!.mount(agentCtx, preset.id)
      },
    })
    try { await workspace.attachSession(sessionId) } catch (error) { await handle.dispose(); throw error }
    return { sessionId }
  }

  async renameSession(sessionId: string, title: string): Promise<{ title: string; seq: number }> {
    return this.call('session/rename', { request: { sessionId, title } })
  }

  async forkSession(sessionId: string, atSeq?: number): Promise<{ sessionId: string }> {
    return this.call('session/fork', { request: { sessionId, ...(atSeq === undefined ? {} : { atSeq }) } })
  }

  private async promptContent(sessionId: string, parts: ConversationContent[]) {
    if (parts.filter(part => part.type === 'image').length > 19) throw new HttpError(400, 'too_many_images', 'Attach at most 19 images per message')
    let bytes = 0
    const content = []
    for (const part of parts) {
      if (part.type === 'text') { content.push(part); continue }
      const image = part.uploadId && this.services.conversationUploads
        ? await this.services.conversationUploads.encoded(sessionId, part.uploadId)
        : { mediaType: part.mediaType, data: part.data ?? '', name: part.name }
      if (!image.data) throw new HttpError(400, 'attachment_data_missing', 'Upload the image before sending it')
      bytes += Math.floor(image.data.length * 3 / 4)
      if (bytes > 40 * 1024 * 1024) throw new HttpError(413, 'images_too_large', 'Images in one message must total at most 40 MiB')
      content.push({ type: 'image' as const, ...image })
    }
    return content
  }

  async prompt(sessionId: string, input: ConversationPromptInput): Promise<{ accepted: true; command?: { kind: 'success'; text?: string } }> {
    const content = await this.promptContent(sessionId, input.content)
    return this.call('session/prompt', { request: { sessionId, ...input, requestId: input.requestId ?? crypto.randomUUID(), content } })
  }

  async updateQueue(sessionId: string, itemId: string, action: ConversationQueueUpdateInput): Promise<{ accepted: true }> {
    return this.call('session/updateQueue', { request: { sessionId, itemId, action } })
  }

  async cancelSession(sessionId: string): Promise<{ accepted: true }> {
    return this.call('session/cancel', { request: { sessionId } })
  }

  async attachment(sessionId: string, attachmentId: string): Promise<unknown> {
    return this.call('session/attachment', { request: { sessionId, attachmentId } })
  }

  async listSkills(sessionId: string): Promise<unknown> {
    return this.call('skills/list', { request: { sessionId } })
  }

  async listCommands(sessionId: string): Promise<unknown> {
    return this.call('commands/list', { agentId: sessionId })
  }

  async executeCommand(
    sessionId: string,
    line: string,
    images: Array<{ mediaType: string; uploadId: string; name?: string }> = [],
  ): Promise<unknown> {
    if (!this.services.conversationUploads && images.length) throw new HttpError(503, 'attachments_unavailable', 'Image storage unavailable')
    const content = await this.promptContent(sessionId, images.map(image => ({ ...image, type: 'image', mediaType: image.mediaType as Extract<ConversationContent, { type: 'image' }>['mediaType'] })))
    return this.call('commands/execute', { agentId: sessionId, line, images: content.filter(part => part.type === 'image').map(({ type: _type, ...image }) => image) })
  }

  async listAgentPresets(): Promise<unknown> {
    return this.agentPresetList()
  }

  async selectAgentPreset(sessionId: string, agentPreset: string): Promise<unknown> {
    return this.call('agentPresets/select', { agentId: sessionId, agentPreset }).then(agentPreset => ({ agentPreset }))
  }

  async listSubagents(parentSessionId: string): Promise<unknown> {
    return this.call('subagents/list', { parentSessionId })
  }

  async subagentHistory(parentSessionId: string, childSessionId: string, mode: 'one-shot' | 'continuable', input: { beforeSeq?: number; maxMessages?: number } = {}): Promise<HarnessHistory> {
    return this.readHistory({ kind: 'subagent', parentSessionId: SessionId(parentSessionId), childSessionId: SessionId(childSessionId), mode }, input)
  }

  async promptSubagent(parentSessionId: string, childSessionId: string, content: ConversationContent[], clientTimeZone?: string, requestId?: string): Promise<unknown> {
    return this.call('subagents/prompt', { request: { requestId: requestId ?? crypto.randomUUID(), parentSessionId, childSessionId, mode: 'continuable', content: await this.promptContent(childSessionId, content), clientTimeZone } })
  }

  async interruptSubagent(parentSessionId: string, childSessionId: string): Promise<unknown> {
    return this.call('subagents/interruptByParent', { parentSessionId, childSessionId, mode: 'continuable' })
  }

  async respond(rpcId: string, result: HarnessInteractionResult<unknown>, signal?: AbortSignal): Promise<{ accepted: boolean; reason?: string }> {
    signal?.throwIfAborted()
    return this.services.notifications?.respond(rpcId, result) ?? { accepted: false, reason: 'interaction source is unavailable' }
  }

  events(kind: 'mux' | 'host', signal: AbortSignal, onOpen: () => void): AsyncIterable<HarnessStreamEnvelope> {
    if (!this.services.notifications) throw new HttpError(503, 'runtime_unavailable', 'Harness notifications are unavailable')
    return this.services.notifications.events(kind, signal, onOpen)
  }

  async runPrompt(cwd: string, prompt: string): Promise<{ sessionId: string }> {
    const session = await this.createSession({ cwd })
    await this.prompt(session.sessionId, { mode: 'queue', content: [{ type: 'text', text: prompt }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    return session
  }

  async promptSession(sessionId: string, prompt: string): Promise<void> {
    await this.prompt(sessionId, { mode: 'queue', content: [{ type: 'text', text: prompt }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
  }

  async openWorkspaceSession(path: string, preferredSessionId?: string): Promise<{ sessionId: string; workspaceId: string }> {
    const created = await this.createWorkspace(path)
    const [workspaceList, sessionList] = await Promise.all([
      this.listWorkspaces(),
      this.listSessions(),
    ])
    const workspace = workspaceList.items.find(item => item.workspaceId === created.workspace.workspaceId)
      ?? created.workspace
    const archived = new Set(workspaceList.archivedSessionIds)
    if (preferredSessionId
      && workspace.sessionIds.includes(preferredSessionId)
      && !archived.has(preferredSessionId)
      && sessionList.some(item => item.sessionId === preferredSessionId)) {
      return { sessionId: preferredSessionId, workspaceId: workspace.workspaceId }
    }
    const reusable = sessionList.find(item => item.blank
      && item.cwd === workspace.path
      && workspace.sessionIds.includes(item.sessionId)
      && !archived.has(item.sessionId))
    if (reusable) return { sessionId: reusable.sessionId, workspaceId: workspace.workspaceId }
    const session = await this.createSession({ workspaceId: workspace.workspaceId })
    return { ...session, workspaceId: workspace.workspaceId }
  }

  async requireSession(sessionId: string): Promise<{ sessionId: string }> {
    const listing = await this.listSessions()
    if (!listing.some(item => item.sessionId === sessionId)) {
      throw new HttpError(404, 'session_not_found', `Harness session not found: ${sessionId}`)
    }
    return { sessionId }
  }
}

/** Omit optional undefined fields before the strict Remote JSON boundary. */
function cleanArguments(args: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(args)) as Record<string, unknown>
}
