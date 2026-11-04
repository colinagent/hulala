/**
 * DSH Remote client and transport-neutral contracts.
 *
 * The TUI never imports Cordis, the Host, or DSH directly: it consumes this
 * narrow backend. The real attachment maps Host frames into these contracts,
 * and the interactive surface can be tested with a fake Host.
 *
 * @module hulala-cli/tui/data/remote
 */
import { Context } from '@deepseek-ai/cordis'
import { apply as gatewayClient } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-remotes/types'
import type { ModelCatalog, SessionControlFrame, SessionFollowFrame, SessionPromptRequest, SessionSelectModelRequest, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'
import SessionRemote from '@deepseek-ai/dsh-api-session-controller/remote'
import SettingsRemote from '@deepseek-ai/dsh-api-settings-controller/remote'
import WorkspaceRemote from '@deepseek-ai/dsh-api-workspace-controller/remote'
import type { WorkspaceCreateRequest } from '@deepseek-ai/dsh-api-workspace-controller/types'
import { installConnection, type ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { AssistantStreamRecord, LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { expandAssistantStream } from '@deepseek-ai/dsh-llm'
import LlmRemote from '@deepseek-ai/dsh-llm/remote'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-user-approval/types'
import type {} from '@deepseek-ai/dsh-user-questions/types'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import WebSocket from 'ws'
import type { HostAttachment } from '../../hostAttach.js'

/** One non-subagent Session as presented by the Host. */
export interface TerminalSession {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  /** Normalized title from the `session/title` projection; absent until one lands. */
  title?: string
  model?: TerminalModel
  agentAvailable?: boolean
}

/**
 * One incremental change to the Host's Session list.
 *
 * The Host publishes `api-session/added` (a whole summary), `removed`,
 * `status`, and `activity`; the terminal keeps its one `sessions` array in step
 * with them instead of polling persistence.
 */
export type SessionListEvent =
  | { kind: 'added'; session: TerminalSession }
  | { kind: 'removed'; sessionId: string }
  | { kind: 'status'; sessionId: string; running: boolean }
  | { kind: 'activity'; sessionId: string; updatedAt: number }

/** Session-wide token and speed totals. */
export interface TerminalMetrics {
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  decodeMs: number
  contextTokens?: number
  contextLimit?: number
}

/** One selectable model route. */
export interface TerminalModel {
  provider: string
  model: string
  reasoningEffort?: string
}

/** One provider group in the model catalog. */
export interface TerminalModelGroup {
  id: string
  name: string
  models: ReadonlyArray<{
    id: string
    name: string
    reasoning?: { efforts: ReadonlyArray<{ id: string; name: string }>; defaultEffort?: string }
  }>
}

/**
 * One provider route `/login` can configure with a stored API key.
 *
 * The terminal never learns a secret back: only whether the route already
 * resolves a credential, and what kind of route it is.
 */
export interface TerminalProvider {
  id: string
  name: string
  /** The route is registered and can serve requests now. */
  active: boolean
  /** A stored or ambient credential currently resolves for the route. */
  configured: boolean
  /** Credential source layer when configured (`file` for the Host's store). */
  source?: string
  /** Route endpoint advertised by the adapter, shown while adding a key. */
  baseURL?: string
}

/** The Host's model catalog. */
export interface TerminalModelCatalog {
  default: TerminalModel
  groups: readonly TerminalModelGroup[]
  failures: ReadonlyArray<{ id: string; name: string; message: string }>
}

/** One pending approval. */
export interface TerminalApproval {
  toolName: string
  reason?: string
  signal?: AbortSignal
}

/** One approval decision accepted by the Host. */
export type TerminalApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled'

/** One question option. */
export interface TerminalQuestionOption {
  label: string
  description?: string
}

/** One pending question. */
export interface TerminalQuestion {
  id: string
  question: string
  detail?: string
  header?: string
  options?: readonly TerminalQuestionOption[]
  multiSelect?: boolean
}

/** One structured answer. */
export interface TerminalQuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

/** One session-content search hit. */
export interface TerminalSearchItem {
  sessionId: string
  snippet: string
}

/**
 * Delivery mode of one ordinary composer message, in the Host's vocabulary.
 *
 * `queue` appends a follow-up turn after the running one; `steer` asks the
 * Agent Loop to claim the text at its next step boundary. A steer that misses
 * the open window parks in the inbox and becomes a plain queued item.
 */
export type TerminalPromptMode = 'queue' | 'steer'

/** One pending inbox occurrence the composer still owns. */
export interface TerminalPendingMessage {
  readonly id: string
  /**
   * Joined text blocks, or `undefined` when the occurrence carries non-text
   * content (an image the terminal cannot render or restore).
   */
  readonly text?: string
}

/** Both durable pending lists, in Host inbox order. */
export interface TerminalInbox {
  /** `next-step`: steering claimed at the running turn's next step boundary. */
  readonly steering: readonly TerminalPendingMessage[]
  /** `next-turn`: follow-up turns queued behind the running one. */
  readonly followUp: readonly TerminalPendingMessage[]
}

/** Live markers delivered while a Session is open. */
export interface TerminalSessionHandlers {
  onEvent(event: TerminalSessionEvent): void
  onAssistantDelta(text: string): void
  /** One reasoning delta; reasoning always precedes the text of its attempt. */
  onReasoningDelta?(text: string): void
  onAssistantEnd(): void
  onError(message: string): void
  onRunning(running: boolean): void
  /** Context occupancy from the `contextPressure` projection (snapshot baseline). */
  onContextPressure?(pressure: { projectedTokens?: number; contextWindow?: number }): void
  /** Both durable pending lists from the `inbox` projection (snapshot and control stream). */
  onInbox?(inbox: TerminalInbox): void
}

/** A durable journal event. */
export interface TerminalSessionEvent {
  type: string
  seq: number
  time: number
  data: unknown
}

/** One attached Host backend. */
export interface TerminalBackend {
  readonly host: { url: string; home?: string }
  ready(): Promise<void>
  listSessions(): Promise<TerminalSession[]>
  searchSessions(query: string): Promise<{ items: TerminalSearchItem[]; hasMore: boolean }>
  ensureWorkspace(path: string): Promise<string>
  createSession(workspaceId: string): Promise<string>
  follow(sessionId: string, handlers: TerminalSessionHandlers): () => void
  prompt(sessionId: string, text: string, mode: TerminalPromptMode): Promise<void>
  /** Drop one still-pending inbox occurrence; a claimed item is no longer removable. */
  removeQueued(sessionId: string, itemId: string): Promise<void>
  cancel(sessionId: string): Promise<void>
  modelCatalog(): Promise<TerminalModelCatalog>
  selectModel(sessionId: string, selection: TerminalModel): Promise<void>
  /** Provider routes this build can configure with an API key. */
  loginProviders(): Promise<TerminalProvider[]>
  /**
   * Store an API key for one provider route.
   *
   * The Host records the profile's credential reference when it has none, then
   * writes the secret through the credential seam; neither value is echoed back.
   */
  login(providerId: string, apiKey: string): Promise<void>
  rename(sessionId: string, title: string): Promise<void>
  onApproval(handler: (request: TerminalApproval) => Promise<TerminalApprovalOutcome>): () => void
  onQuestion(handler: (questions: readonly TerminalQuestion[], signal?: AbortSignal) => Promise<{ answers: TerminalQuestionAnswer[] } | undefined>): () => void
  onSessionStatus(handler: (sessionId: string, running: boolean) => void): () => void
  onSessionError(handler: (sessionId: string, message: string) => void): () => void
  /**
   * Every incremental change to the visible Session list.
   *
   * Subagent Sessions are filtered out here, so a caller never has to repeat the
   * `origin` check. The returned function unsubscribes all four Host events.
   * @param handler - receives each list change as it lands.
   * @returns unsubscribe; the Host connection itself is closed separately.
   */
  onSessionList(handler: (event: SessionListEvent) => void): () => void
  close(): Promise<void>
}

/** Unwrap one Host Remote result or throw its stable failure. */
function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw new Error(`${result.error.code}: ${result.error.message}`)
}

/** Read the `contextPressure` projection out of a projection value block. */
function pressureOf(values: unknown): { projectedTokens?: number; contextWindow?: number } | undefined {
  if (values === null || typeof values !== 'object') return undefined
  const pressure = (values as { contextPressure?: { projectedTokens?: number; contextWindow?: number } }).contextPressure
  if (pressure === null || typeof pressure !== 'object') return undefined
  return {
    ...(typeof pressure.projectedTokens === 'number' ? { projectedTokens: pressure.projectedTokens } : {}),
    ...(typeof pressure.contextWindow === 'number' ? { contextWindow: pressure.contextWindow } : {}),
  }
}

/** Join a pending occurrence's text blocks; `undefined` when any block is not text. */
function pendingTextOf(content: unknown): string | undefined {
  if (!Array.isArray(content) || content.length === 0) return undefined
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') return undefined
    const record = block as { type?: unknown; text?: unknown }
    if (record.type !== 'text' || typeof record.text !== 'string') return undefined
    parts.push(record.text)
  }
  return parts.join('')
}

/** One provider entry joined with the credential reference it resolves through. */
interface ProviderProfile {
  entry: LlmConfigurableProvider
  /** Reference a typed key is stored under; absent when the route takes no API key. */
  keyRef: string | undefined
}

/** Read a nested value from a settings view or profile. */
function valueAt(root: unknown, path: readonly string[]): unknown {
  let current = root
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** The credential reference a profile names, when it names one. */
function namedKeyRef(profile: unknown): string | undefined {
  if (profile === null || typeof profile !== 'object') return undefined
  const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/**
 * Conventional reference for a route that names none: `<ROUTE>_API_KEY`.
 *
 * This is the same derivation the Web Models page uses, so a key typed in the
 * terminal and a key typed in the Desktop land on the same stored reference.
 * @param provider - provider route id, e.g. `minimax-cn`.
 * @returns the reference name, e.g. `MINIMAX_CN_API_KEY`.
 */
function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_API_KEY`
}

/** Whether this route authenticates with an API key at all. */
function acceptsApiKey(entry: LlmConfigurableProvider, named: string | undefined): boolean {
  if (named !== undefined) return true
  // The DeepSeek adapter ships one key-based route whose reference comes from
  // the resolved profile default rather than the route name.
  if (entry.settingsNs === 'llm-deepseek') return true
  // A pi-ai route takes a derived key unless the adapter advertises no
  // environment authentication and only an account sign-in (e.g. Codex).
  if (entry.settingsNs === 'llm-pi-ai') return entry.nativeAuth === undefined || entry.nativeAuth.env.length > 0
  return false
}

/** Narrow the `inbox` projection to the two lists the terminal can show.
 *
 * The wire value is a JSON-safe copy of the Agent's pending messages, so every
 * field is read defensively. Non-user producers (injected context and recalled
 * material) also reach `next-step`, but the composer never restores them, so
 * they stay out of the pending display rather than appearing as prompts.
 * @param value - the `inbox` projection value, if the Session has one.
 * @returns both pending lists in inbox order; empty when the projection is absent.
 */
export function inboxOf(value: unknown): TerminalInbox {
  const empty: TerminalInbox = { steering: [], followUp: [] }
  if (value === null || typeof value !== 'object') return empty
  const narrow = (list: unknown): TerminalPendingMessage[] => {
    if (!Array.isArray(list)) return []
    const items: TerminalPendingMessage[] = []
    for (const entry of list) {
      if (entry === null || typeof entry !== 'object') continue
      const record = entry as { id?: unknown; source?: unknown; content?: unknown }
      if (typeof record.id !== 'string') continue
      const source = record.source
      if (source === null || typeof source !== 'object') continue
      if ((source as { kind?: unknown }).kind !== 'user') continue
      const text = pendingTextOf(record.content)
      items.push({ id: record.id, ...(text === undefined ? {} : { text }) })
    }
    return items
  }
  const inbox = value as { 'next-step'?: unknown; 'next-turn'?: unknown }
  return { steering: narrow(inbox['next-step']), followUp: narrow(inbox['next-turn']) }
}

/** Narrow one summary to the terminal's non-subagent row. */
function sessionOf(summary: SessionSummary): TerminalSession {
  const values = summary.projections?.values as {
    modelSelection?: { next?: TerminalModel | null }
    title?: unknown
  } | undefined
  const selection = values?.modelSelection?.next
  const title = typeof values?.title === 'string' && values.title.trim() !== '' ? values.title : undefined
  return {
    sessionId: summary.sessionId,
    updatedAt: summary.updatedAt,
    running: summary.running,
    blank: summary.blank,
    agentAvailable: summary.agentAvailable,
    ...(summary.cwd === undefined ? {} : { cwd: summary.cwd }),
    ...(title === undefined ? {} : { title }),
    ...(selection === undefined || selection === null ? {} : { model: { ...selection } }),
  }
}

/** Narrow the Host catalog to the terminal's provider groups. */
function catalogOf(catalog: ModelCatalog): TerminalModelCatalog {
  return {
    default: { ...catalog.default },
    groups: catalog.groups.map(group => ({
      id: group.id,
      name: group.name,
      models: group.models.map(model => ({
        id: model.id,
        name: model.name,
        ...(model.reasoning === undefined ? {} : {
          reasoning: {
            efforts: model.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name })),
            ...(model.reasoning.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort }),
          },
        }),
      })),
    })),
    failures: catalog.failures.map(failure => ({ id: failure.id, name: failure.name, message: failure.message })),
  }
}

/**
 * Attach one DSH Node client to the already-authenticated Host.
 *
 * When `context` is given, the transport plugins are installed on that context
 * and the caller owns its lifetime — the terminal kernel disposes it when the
 * window closes. Without one this function makes and owns its own context,
 * which is what keeps it usable on its own.
 * @param attachment - endpoint plus the Cookie `/connect` issued.
 * @param context - the kernel's context to install into, if any.
 * @returns the terminal backend, ready for Session calls.
 */
export async function createHostBackend(attachment: HostAttachment, context?: Context): Promise<TerminalBackend> {
  const ownsContext = context === undefined
  const ctx = context ?? new Context()
  installConnection(ctx, {
    interactions: 'answer',
    transport: {
      streamBaseUrl: attachment.baseUrl,
      fetch: (input, init) => fetch(new URL(String(input), attachment.baseUrl), {
        ...init,
        headers: { ...Object.fromEntries(new Headers(init.headers)), cookie: attachment.cookie },
      }),
      createWebSocket: url => new WebSocket(url, {
        headers: { cookie: attachment.cookie, origin: attachment.baseUrl },
      }) as never,
    },
  })
  await ctx.plugin(TypertRegistry)
  await ctx.plugin({ apply: gatewayClient, inject: ['typert', 'connection'] })
  await ctx.remote.$mount(SessionRemote)
  await ctx.remote.$mount(WorkspaceRemote)
  await ctx.remote.$mount(LlmRemote)
  await ctx.remote.$mount(SettingsRemote)
  ctx.typert.contexts.registerClient('agent', {
    identity: () => undefined,
    resolve: () => ctx,
  })
  const connection = ctx.get('connection') as ConnectionHandle
  const home = (): string | undefined => ctx.remote.$host.home
  let closed = false

  /**
   * Join the provider directory with each route's credential reference.
   *
   * The directory names the settings profile that activates a route; the
   * settings view is where a profile's `apiKeyEnv` (and its revision) comes
   * from, because only the Host may read a stored profile.
   */
  const describeProviders = async (): Promise<Array<ProviderProfile & { named: string | undefined; revision: number }>> => {
    const directory = unwrap(await ctx.remote.llm.listConfigurableProviders())
    const described = unwrap(await ctx.remote.settings.describe())
    return directory.map(entry => {
      const namespace = described.namespaces.find(candidate => candidate.ns === entry.settingsNs)
      const profile = namespace === undefined ? undefined : valueAt(namespace.value, entry.settingsPath)
      const named = namedKeyRef(profile)
      return {
        entry,
        named,
        keyRef: acceptsApiKey(entry, named) ? named ?? deriveKeyRef(entry.provider) : undefined,
        revision: namespace?.revision ?? 0,
      }
    })
  }

  return {
    get host() {
      const hostHome = home()
      return { url: attachment.baseUrl, ...(hostHome === undefined ? {} : { home: hostHome }) }
    },

    async ready() {
      if (connection.generation.getSnapshot() !== undefined) return
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          unsubscribe()
          reject(new Error('Timed out waiting for the Host event connection'))
        }, 15_000)
        const check = (): void => {
          if (connection.generation.getSnapshot() === undefined) return
          clearTimeout(timer)
          unsubscribe()
          resolve()
        }
        const unsubscribe = connection.generation.subscribe(check)
        check()
      })
    },

    async listSessions() {
      const value = unwrap(await ctx.remote.session.list({}))
      return value.items
        .filter(summary => summary.origin !== 'subagent')
        .map(sessionOf)
        .sort((left, right) => right.updatedAt - left.updatedAt)
    },

    async searchSessions(query) {
      const value = unwrap(await ctx.remote.session.search({ query }))
      return {
        items: value.items.map(item => ({ sessionId: item.sessionId, snippet: item.snippet })),
        hasMore: value.hasMore,
      }
    },

    async ensureWorkspace(path) {
      const request: WorkspaceCreateRequest = { path }
      return unwrap(await ctx.remote.workspace.create(request)).workspace.workspaceId
    },

    async createSession(workspaceId) {
      return unwrap(await ctx.remote.session.create({ workspaceId: workspaceId as never })).sessionId
    },

    follow(sessionId, handlers) {
      const abort = new AbortController()
      let lastSeq = -1
      const stream = ctx.remote.session.follow({
        address: { kind: 'session', sessionId: sessionId as never },
        maxMessages: 200,
        assistantStream: true,
      }, abort.signal)
      const emit = (event: { type: string; seq: number; time: number; data: unknown }): void => {
        if (event.seq <= lastSeq) return
        lastSeq = event.seq
        handlers.onEvent(event as TerminalSessionEvent)
      }
      const pump = async (): Promise<void> => {
        try {
          for await (const frame of stream as AsyncIterable<SessionFollowFrame>) {
            if (abort.signal.aborted) return
            if (frame.type === 'snapshot') {
              const pressure = pressureOf(frame.projections.values)
              if (pressure !== undefined) handlers.onContextPressure?.(pressure)
              handlers.onInbox?.(inboxOf((frame.projections.values as { inbox?: unknown }).inbox))
              for (const record of frame.records) emit(record.event)
              lastSeq = Math.max(lastSeq, frame.cursor)
              if (frame.assistantStream !== undefined) {
                if (frame.assistantStream.activeAttempt !== undefined) {
                  const chunks = expandAssistantStream(frame.assistantStream.activeAttempt.stream as readonly AssistantStreamRecord[])
                  const reasoning = chunks
                    .filter(entry => entry.chunk.type === 'reasoning-delta')
                    .map(entry => entry.chunk.type === 'reasoning-delta' ? entry.chunk.text : '')
                    .join('')
                  if (reasoning !== '') handlers.onReasoningDelta?.(reasoning)
                  const text = chunks
                    .filter(entry => entry.chunk.type === 'text-delta')
                    .map(entry => entry.chunk.type === 'text-delta' ? entry.chunk.text : '')
                    .join('')
                  if (text !== '') handlers.onAssistantDelta(text)
                }
              }
              continue
            }
            if (frame.type === 'assistant-stream') {
              if (frame.frame.type === 'chunk') {
                const chunk = frame.frame.chunk as { type?: string; text?: string }
                if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') handlers.onReasoningDelta?.(chunk.text)
                else if (chunk.type === 'text-delta' && typeof chunk.text === 'string') handlers.onAssistantDelta(chunk.text)
              } else if (frame.frame.type === 'end') {
                handlers.onAssistantEnd()
              }
              continue
            }
            emit(frame.event)
          }
        } catch (error) {
          if (!abort.signal.aborted) handlers.onError(error instanceof Error ? error.message : String(error))
        }
      }
      void pump()

      // Live projection updates (`contextPressure` occupancy, pending `inbox`) ride the
      // control stream, which is also where a reconnect re-reads the baseline.
      const controlAbort = new AbortController()
      const control = ctx.remote.session.control(controlAbort.signal)
      void (async () => {
        try {
          for await (const frame of control as AsyncIterable<SessionControlFrame>) {
            if (controlAbort.signal.aborted) return
            if (frame.type === 'baseline') {
              const block = frame.value.projections[sessionId as never]
              const pressure = pressureOf(block?.values)
              if (pressure !== undefined) handlers.onContextPressure?.(pressure)
              handlers.onInbox?.(inboxOf((block?.values as { inbox?: unknown } | undefined)?.inbox))
            } else if (frame.type === 'projection' && frame.sessionId === sessionId && frame.key === 'contextPressure') {
              const pressure = pressureOf({ contextPressure: frame.value })
              if (pressure !== undefined) handlers.onContextPressure?.(pressure)
            } else if (frame.type === 'projection' && frame.sessionId === sessionId && frame.key === 'inbox') {
              handlers.onInbox?.(inboxOf(frame.value))
            }
          }
        } catch {
          // Control stream loss is non-fatal; the follow stream owns the error path.
        }
      })()

      return () => {
        abort.abort()
        controlAbort.abort()
        stream.dispose()
        control.dispose()
      }
    },

    async prompt(sessionId, text, mode) {
      const request: SessionPromptRequest = {
        requestId: crypto.randomUUID() as never,
        sessionId: sessionId as never,
        mode,
        content: [{ type: 'text', text }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }
      unwrap(await ctx.remote.session.prompt(request))
    },

    async removeQueued(sessionId, itemId) {
      unwrap(await ctx.remote.session.updateQueue({
        sessionId: sessionId as never,
        itemId: itemId as never,
        action: { kind: 'remove' },
      }))
    },

    async cancel(sessionId) {
      unwrap(await ctx.remote.session.cancel({ sessionId: sessionId as never }))
    },

    async modelCatalog() {
      return catalogOf(unwrap(await ctx.remote.session.modelCatalog()))
    },

    async selectModel(sessionId, selection: TerminalModel) {
      const request: SessionSelectModelRequest = {
        sessionId: sessionId as never,
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort as never }),
      }
      unwrap(await ctx.remote.session.selectModel(request))
    },

    async loginProviders() {
      const [profiles, registered] = await Promise.all([
        describeProviders(),
        ctx.remote.llm.listProviders(),
      ])
      const active = new Set(unwrap(registered).map(provider => provider.id))
      const refs = [...new Set(profiles.flatMap(profile => profile.keyRef === undefined ? [] : [profile.keyRef]))].slice(0, 64)
      const credentials = refs.length === 0 ? {} : unwrap(await ctx.remote.credentials.describe(refs))
      return profiles.flatMap(profile => {
        if (profile.keyRef === undefined) return []
        const credential = credentials[profile.keyRef]
        return [{
          id: profile.entry.provider,
          name: profile.entry.displayName,
          active: active.has(profile.entry.provider),
          configured: credential?.configured === true,
          ...(credential?.source === undefined ? {} : { source: credential.source }),
          ...(profile.entry.defaultBaseURL === undefined ? {} : { baseURL: profile.entry.defaultBaseURL }),
        }]
      }).sort((left, right) =>
        Number(right.active) - Number(left.active)
        || Number(right.configured) - Number(left.configured)
        || left.name.localeCompare(right.name))
    },

    async login(providerId, apiKey) {
      const key = apiKey.trim()
      if (key === '') throw new Error('an API key is required')
      const profile = (await describeProviders()).find(candidate => candidate.entry.provider === providerId)
      if (profile === undefined) throw new Error(`provider ${providerId} is not configurable on this Host`)
      if (profile.keyRef === undefined) {
        throw new Error(`${profile.entry.displayName} does not accept an API key here; sign in from the Desktop app`)
      }
      // The pi-ai adapter only reads a stored key when the profile names its
      // reference, so record the derived one first, exactly like the Web Models
      // page; the DeepSeek adapter already ships `DEEPSEEK_API_KEY`.
      if (profile.entry.settingsNs === 'llm-pi-ai' && profile.named === undefined) {
        unwrap(await ctx.remote.settings.mutate(
          profile.entry.settingsNs,
          [{ op: 'set', path: [...profile.entry.settingsPath, 'apiKeyEnv'], value: profile.keyRef }],
          profile.revision,
        ))
      }
      unwrap(await ctx.remote.credentials.set(profile.keyRef, key))
    },

    async rename(sessionId, title) {
      unwrap(await ctx.remote.session.rename({ sessionId: sessionId as never, title }))
    },

    onApproval(handler) {
      return ctx.remote.$on('approval/request', async (request) => {
        const approval: TerminalApproval = {
          toolName: request.toolName,
          ...(request.reason === undefined ? {} : { reason: request.reason }),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        }
        return await handler(approval) as TerminalApprovalOutcome
      })
    },

    onQuestion(handler) {
      return ctx.remote.$on('user-questions/request', async (request, next) => {
        const questions: TerminalQuestion[] = request.questions.map(question => ({
          id: question.id,
          question: question.question,
          ...(question.detail === undefined ? {} : { detail: question.detail }),
          ...(question.header === undefined ? {} : { header: question.header }),
          ...(question.options === undefined ? {} : {
            options: question.options.map(option => ({
              label: option.label,
              ...(option.description === undefined ? {} : { description: option.description }),
            })),
          }),
          ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
        }))
        const answer = await handler(questions, request.signal)
        if (answer === undefined) return await next()
        return { answers: answer.answers } satisfies AskUserQuestionAnswer
      })
    },

    onSessionStatus(handler) {
      return ctx.remote.$on('api-session/status', (sessionId, running) => { handler(sessionId, running) })
    },

    onSessionError(handler) {
      return ctx.remote.$on('api-session/error', (sessionId, message) => { handler(sessionId, message) })
    },

    onSessionList(handler) {
      const disposers = [
        ctx.remote.$on('api-session/added', summary => {
          if (summary.origin === 'subagent') return
          handler({ kind: 'added', session: sessionOf(summary) })
        }),
        ctx.remote.$on('api-session/removed', sessionId => { handler({ kind: 'removed', sessionId }) }),
        ctx.remote.$on('api-session/status', (sessionId, running) => { handler({ kind: 'status', sessionId, running }) }),
        ctx.remote.$on('api-session/activity', (sessionId, updatedAt) => { handler({ kind: 'activity', sessionId, updatedAt }) }),
      ]
      return () => { for (const dispose of disposers) dispose() }
    },

    async close() {
      if (closed) return
      closed = true
      // The kernel owns a context it supplied; only a self-made one goes with
      // this backend.
      if (ownsContext) await ctx.fiber.dispose()
    },
  }
}
