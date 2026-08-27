import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { Context, Service } from '@deepseek-ai/cordis'
import {
  emitAgentEvent,
  type Agent,
  type AgentFactory,
  type AgentHandle,
  type AgentOptions,
  type AgentSetup,
  type CreateAgentOptions,
  type ResumeAgentOptions,
} from '@deepseek-ai/dsh-agent'
import { SessionPreparation, type Session } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import { HarnessSdkAgent, withSessionPreparation, type HarnessSdkSession } from '@hulala/dsh-agent-loop-pi'
import { registerRuntimeControl, runtimeSelection, type RuntimeSelection } from '@hulala/dsh-agent-loop-selector'
import type {} from '@hulala/dsh-network-proxy'

type JsonRecord = Record<string, unknown>
type Listener = Parameters<HarnessSdkSession['subscribe']>[0]

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: unknown): void
}

interface CodexModelView {
  provider: 'openai'
  providerName: 'OpenAI'
  id: string
  name: string
  default?: boolean
  thinkingLevels: string[]
  defaultThinkingLevel?: string
}

export function codexModelView(value: unknown): CodexModelView | undefined {
  const model = asRecord(value)
  if (model.hidden === true || typeof model.model !== 'string') return undefined
  const thinkingLevels = (Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [])
    .flatMap(option => {
      const effort = asRecord(option).reasoningEffort
      return typeof effort === 'string' && effort.length > 0 ? [effort] : []
    })
  const defaultThinkingLevel = typeof model.defaultReasoningEffort === 'string' ? model.defaultReasoningEffort : thinkingLevels[0]
  return {
    provider: 'openai', providerName: 'OpenAI', id: model.model,
    name: typeof model.displayName === 'string' ? model.displayName : model.model,
    ...(model.isDefault === true ? { default: true } : {}),
    thinkingLevels,
    ...(defaultThinkingLevel === undefined ? {} : { defaultThinkingLevel }),
  }
}

/** Minimal typed JSONL client for Codex's rich app-server protocol. */
class CodexAppServer {
  private child: ChildProcessWithoutNullStreams | undefined
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly notifications = new Set<(method: string, params: JsonRecord) => void>()
  private requestHandler: ((method: string, params: JsonRecord) => Promise<unknown>) | undefined
  private starting: Promise<void> | undefined
  private stale = false
  private generation = 0

  constructor(private readonly env: () => Record<string, string>) {}

  get currentGeneration(): number { return this.generation }
  get needsRefresh(): boolean { return this.stale }

  markStale(): void { this.stale = true }

  async prepare(): Promise<void> {
    if (this.stale) {
      this.stop()
      this.stale = false
    }
    await this.start()
  }

  setRequestHandler(handler: (method: string, params: JsonRecord) => Promise<unknown>): void {
    this.requestHandler = handler
  }

  subscribe(listener: (method: string, params: JsonRecord) => void): () => void {
    this.notifications.add(listener)
    return () => this.notifications.delete(listener)
  }

  async request(method: string, params: JsonRecord = {}): Promise<unknown> {
    await this.start()
    const id = this.nextId++
    const result = Promise.withResolvers<unknown>()
    this.pending.set(id, result)
    this.write({ method, id, params })
    return result.promise
  }

  private start(): Promise<void> {
    return this.starting ??= (async () => {
      const child = this.child = spawn(process.env.CODEX_BINARY ?? 'codex', ['app-server', '--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.env(),
      })
      child.stderr.on('data', chunk => process.stderr.write(chunk))
      child.once('exit', (code, signal) => {
        if (this.child !== child) return
        const error = new Error(`codex app-server exited (${code ?? signal ?? 'unknown'})`)
        for (const pending of this.pending.values()) pending.reject(error)
        this.pending.clear()
        this.child = undefined
        this.starting = undefined
      })
      createInterface({ input: child.stdout }).on('line', line => {
        if (!line.trim()) return
        try { void this.receive(JSON.parse(line) as JsonRecord) }
        catch (error) { process.stderr.write(`invalid codex app-server frame: ${String(error)}\n`) }
      })
      const initialized = await this.requestBeforeStart('initialize', {
        clientInfo: { name: 'hulala', title: 'Hulala Harness', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      })
      if (initialized === undefined) throw new Error('codex app-server returned no initialize result')
      this.write({ method: 'initialized', params: {} })
      this.generation += 1
    })()
  }

  private requestBeforeStart(method: string, params: JsonRecord): Promise<unknown> {
    const id = this.nextId++
    const result = Promise.withResolvers<unknown>()
    this.pending.set(id, result)
    this.write({ method, id, params })
    return result.promise
  }

  private write(message: unknown): void {
    if (this.child === undefined) throw new Error('codex app-server is not running')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private async receive(message: JsonRecord): Promise<void> {
    if (typeof message.method === 'string' && (typeof message.id === 'number' || typeof message.id === 'string')) {
      try {
        const result = await this.requestHandler?.(message.method, (message.params ?? {}) as JsonRecord)
        this.write({ id: message.id, result: result ?? { decision: 'decline' } })
      } catch (error) {
        this.write({ id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })
      }
      return
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
      return
    }
    if (typeof message.method === 'string') {
      const params = (message.params ?? {}) as JsonRecord
      for (const listener of this.notifications) listener(message.method, params)
    }
  }

  private stop(): void {
    const child = this.child
    this.child = undefined
    this.starting = undefined
    const error = new Error('codex app-server restarted after network proxy changed')
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    child?.kill('SIGTERM')
  }

  async dispose(): Promise<void> { this.stop() }
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' ? value as JsonRecord : {}
}

class CodexSdkSession implements HarnessSdkSession {
  readonly runtime = 'codex'
  readonly model: { provider: string; id: string }
  private readonly listeners = new Set<Listener>()
  private readonly unsubscribe: () => void
  private activeTurnId: string | undefined
  private completion: PromiseWithResolvers<void> | undefined
  private agent: Agent | undefined
  serverGeneration: number

  constructor(
    private readonly server: CodexAppServer,
    readonly threadId: string,
    model: string,
    private thinkingLevel: string | undefined,
    readonly cwd: string,
    generation: number,
    private readonly ensureCurrent: (session: CodexSdkSession) => Promise<void>,
  ) {
    this.model = { provider: 'openai', id: model }
    this.serverGeneration = generation
    this.unsubscribe = server.subscribe((method, params) => this.consume(method, params))
  }

  bindAgent(agent: Agent): void { this.agent = agent }
  configure(model: string, thinkingLevel: string | undefined): void {
    if (this.active) throw new Error('Wait for the current Codex turn to finish before changing model or Thinking Level.')
    this.model.id = model
    this.thinkingLevel = thinkingLevel
  }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private emit(event: Parameters<Listener>[0]): void { for (const listener of this.listeners) listener(event) }

  async prompt(text: string): Promise<void> {
    await this.ensureCurrent(this)
    this.emit({ type: 'turn_start' })
    this.completion = Promise.withResolvers<void>()
    try {
      const result = asRecord(await this.server.request('turn/start', {
        threadId: this.threadId,
        input: [{ type: 'text', text }],
        model: this.model.id,
        ...(this.thinkingLevel === undefined ? {} : { effort: this.thinkingLevel }),
      }))
      this.activeTurnId = String(asRecord(result.turn).id ?? '')
      await this.completion.promise
    } catch (error) {
      this.completion = undefined
      throw error
    }
  }

  async steer(text: string): Promise<void> {
    if (this.activeTurnId === undefined) return
    await this.server.request('turn/steer', {
      threadId: this.threadId,
      input: [{ type: 'text', text }],
    })
  }

  async followUp(text: string): Promise<void> { await this.prompt(text) }

  get active(): boolean { return this.completion !== undefined }

  async abort(): Promise<void> {
    if (this.activeTurnId === undefined) return
    await this.server.request('turn/interrupt', { threadId: this.threadId, turnId: this.activeTurnId })
  }

  dispose(): void { this.unsubscribe() }

  async approval(method: string, params: JsonRecord): Promise<unknown> {
    const agent = this.agent
    const questions = agent?.ctx.get('userQuestions')
    if (agent === undefined || questions === undefined) return { decision: 'decline' }
    const id = `codex-${crypto.randomUUID()}`
    const label = method.includes('fileChange') ? 'Apply file changes' : method.includes('permissions') ? 'Grant permissions' : 'Run command'
    const detail = JSON.stringify(params, null, 2)
    const answer = await questions.ask({
      agent,
      questions: [{
        id, header: label, question: String(params.reason ?? `Allow Codex to ${label.toLowerCase()}?`), detail,
        options: [
          { label: 'Allow', description: 'Allow this action once.' },
          { label: 'Deny', description: 'Reject this action.' },
        ],
      }],
    })
    const selected = answer.answers.find((candidate: { id: string; selected: string[] }) => candidate.id === id)?.selected[0]
    return { decision: selected === 'Allow' ? 'accept' : 'decline' }
  }

  private consume(method: string, params: JsonRecord): void {
    if (params.threadId !== this.threadId) return
    if (method === 'turn/started') {
      this.activeTurnId = String(asRecord(params.turn).id ?? '')
      return
    }
    if (method === 'turn/completed') {
      const turn = asRecord(params.turn)
      const status = String(turn.status ?? '')
      const done = this.completion
      this.completion = undefined
      this.activeTurnId = undefined
      if (status === 'failed') done?.reject(new Error(String(asRecord(turn.error).message ?? 'Codex turn failed')))
      else done?.resolve()
      return
    }
    if (method !== 'item/started' && method !== 'item/completed') return
    const item = asRecord(params.item)
    const type = String(item.type ?? '')
    const itemId = String(item.id ?? crypto.randomUUID())
    if (type === 'agentMessage' && method === 'item/completed') {
      this.emit({
        type: 'message_end',
        message: {
          role: 'assistant', content: [{ type: 'text', text: String(item.text ?? '') }],
          api: 'openai-responses', provider: 'openai', model: this.model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop', timestamp: Date.now(),
        },
      })
      return
    }
    const toolName = type === 'commandExecution' ? 'shell'
      : type === 'fileChange' ? 'apply_patch'
        : type === 'mcpToolCall' ? `${String(item.server)}/${String(item.tool)}`
          : type === 'webSearch' ? 'web_search' : type === 'imageGeneration' ? 'image_generation' : undefined
    if (toolName === undefined) return
    if (method === 'item/started') this.emit({ type: 'tool_execution_start', toolCallId: itemId, toolName, args: item })
    else this.emit({
      type: 'tool_execution_end', toolCallId: itemId, toolName,
      result: item.aggregatedOutput ?? item.result ?? item.changes ?? item,
      isError: item.status === 'failed' || item.status === 'declined',
    })
  }
}

export interface Config { model?: string }

export class CodexAgentLoop extends Service implements AgentFactory {
  static inject = ['agents', 'sessions', 'networkProxy']
  static Config = z.object({ model: z.string() }) as z<Config>
  private readonly server: CodexAppServer
  private readonly handles = new Set<AgentHandle>()
  private readonly threadIds = new Map<string, string>()
  private readonly nativeSessions = new Map<string, CodexSdkSession>()
  private readonly sessionsByHarnessId = new Map<string, CodexSdkSession>()
  private defaultModel: string | undefined

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'codexAgentLoop')
    this.server = new CodexAppServer(() => ctx.networkProxy.childEnv())
    ctx.effect(() => ctx.networkProxy.watch(() => this.server.markStale()), 'codexAgentLoop.proxy()')
    ctx.effect(() => registerRuntimeControl('codex', this), 'codexAgentLoop.control()')
    this.server.setRequestHandler(async (method, params) => {
      const threadId = typeof params.threadId === 'string' ? params.threadId : undefined
      if (threadId === undefined) return { decision: 'decline' }
      return this.nativeSessions.get(threadId)?.approval(method, params) ?? { decision: 'decline' }
    })
    ctx.effect(() => ctx.agents.setFactory(this), 'codexAgentLoop.setFactory()')
    ctx.effect(() => async () => {
      await Promise.all([...this.handles].map(handle => handle.dispose()))
      await this.server.dispose()
    })
  }

  async models(): Promise<CodexModelView[]> {
    await this.prepareServer()
    const result = asRecord(await this.server.request('model/list', { limit: 100 }))
    return (Array.isArray(result.data) ? result.data : []).flatMap((value): CodexModelView[] => {
      const view = codexModelView(value)
      if (view === undefined) return []
      if (view.default === true) this.defaultModel = view.id
      return [view]
    })
  }

  async configure(selection: RuntimeSelection, sessionId?: string): Promise<void> {
    if (selection.model === undefined) return
    const models = await this.models()
    const model = models.find(candidate => candidate.id === selection.model)
    if (model === undefined) throw new Error(`Codex model "${selection.model}" is not available`)
    const thinkingLevel = selection.thinkingLevel ?? model.defaultThinkingLevel
    const sessions = sessionId === undefined
      ? [...this.nativeSessions.values()]
      : [this.sessionsByHarnessId.get(sessionId)].filter((session): session is CodexSdkSession => session !== undefined)
    if (sessionId !== undefined && sessions.length === 0) throw new Error(`Codex session "${sessionId}" is not active`)
    if (sessions.some(session => session.active)) {
      throw new Error('Wait for the current Codex turn to finish before changing model or Thinking Level.')
    }
    for (const session of sessions) session.configure(model.id, thinkingLevel)
  }

  async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
    const preparation = SessionPreparation.create(this.ctx.sessions.prepare(options.sessionId, {
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(options.meta === undefined ? {} : { meta: options.meta }),
    }))
    return withSessionPreparation(preparation, session =>
      this.create(ownerCtx, session, options.agentOptions ?? {}, options.setup, false))
  }

  async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) throw new Error('cannot resume: session persistence is not configured')
    const preparation = await persistence.prepare(options.resumeSessionId, options.signal)
    return withSessionPreparation(preparation, session =>
      this.create(ownerCtx, session, options.agentOptions ?? {}, options.setup, true))
  }

  private async create(ownerCtx: Context, session: Session, options: AgentOptions, setup: AgentSetup | undefined, resume: boolean): Promise<AgentHandle> {
    const selected = runtimeSelection()
    const models = await this.models()
    let model = (selected.runtime === 'codex' ? selected.model : undefined)
      ?? this.config.model
    if (model === undefined) {
      model = this.defaultModel ?? models[0]?.id
    }
    if (model === undefined) throw new Error('Codex app-server reported no available model')
    const modelView = models.find(candidate => candidate.id === model)
    const requestedThinking = selected.runtime === 'codex' ? selected.thinkingLevel : undefined
    const thinkingLevel = requestedThinking !== undefined && modelView?.thinkingLevels.includes(requestedThinking)
      ? requestedThinking
      : modelView?.defaultThinkingLevel
    await this.prepareServer()
    const existingThreadId = this.threadIds.get(session.id)
    const method = resume && existingThreadId !== undefined ? 'thread/resume' : 'thread/start'
    const result = asRecord(await this.server.request(method, {
      ...(existingThreadId === undefined ? {} : { threadId: existingThreadId }),
      model,
      cwd: session.header.cwd ?? process.cwd(),
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
    }))
    const threadId = String(asRecord(result.thread).id ?? '')
    if (!threadId) throw new Error('codex app-server returned no thread id')
    this.threadIds.set(session.id, threadId)
    const cwd = session.header.cwd ?? process.cwd()
    const native = new CodexSdkSession(this.server, threadId, model, thinkingLevel, cwd, this.server.currentGeneration,
      candidate => this.ensureSessionCurrent(candidate))
    this.nativeSessions.set(threadId, native)
    this.sessionsByHarnessId.set(session.id, native)
    const agent = new HarnessSdkAgent(this.ctx, session.id, { provider: 'openai', model }, session, native)
    native.bindAgent(agent)
    let detachSession: (() => void) | undefined
    let detachAgent: (() => void) | undefined
    let disposing: Promise<void> | undefined
    const handle: AgentHandle = { agent, dispose: () => (disposing ??= (async () => {
      await agent.dispose(); this.nativeSessions.delete(threadId); this.sessionsByHarnessId.delete(session.id); detachAgent?.(); detachSession?.(); this.handles.delete(handle)
    })()) }
    try {
      const commit = await setup?.(agent.ctx); commit?.commit()
      detachSession = agent.ctx.sessions.enter(session); detachAgent = this.ctx.agents.enter(agent, ownerCtx.agent)
      agent.ctx.sessions.announce(session); this.ctx.agents.announce(agent)
      emitAgentEvent(this.ctx, agent, 'agent/session-start', { source: resume ? 'resume' : 'startup' })
      this.handles.add(handle)
      ownerCtx.effect(() => () => handle.dispose(), `codexAgentLoop.lifecycle(${session.id})`)
      return handle
    } catch (error) { await handle.dispose(); throw error }
  }

  private async prepareServer(): Promise<void> {
    if (this.server.needsRefresh && [...this.nativeSessions.values()].some(session => session.active)) {
      throw new Error('The proxy change will apply after the current Codex turn finishes.')
    }
    await this.server.prepare()
  }

  private async ensureSessionCurrent(session: CodexSdkSession): Promise<void> {
    await this.prepareServer()
    if (session.serverGeneration === this.server.currentGeneration) return
    await this.server.request('thread/resume', {
      threadId: session.threadId,
      model: session.model.id,
      cwd: session.cwd,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
    })
    session.serverGeneration = this.server.currentGeneration
  }
}

export default CodexAgentLoop
