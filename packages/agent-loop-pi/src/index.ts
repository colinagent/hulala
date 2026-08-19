import type { AgentSession, AgentSessionEvent, ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type AuthEvent,
  type AuthPrompt,
  type ModelThinkingLevel,
} from '@earendil-works/pi-ai'
import {
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent'
import { Context, Service } from '@deepseek-ai/cordis'
import {
  Inbox,
  agentEvents,
  emitAgentEvent,
  type Agent,
  type AgentCancelCause,
  type AgentFactory,
  type AgentHandle,
  type AgentOptions,
  type AgentSetup,
  type AgentStatus,
  type CancelOptions,
  type CreateAgentOptions,
  type InboxTarget,
  type ResumeAgentOptions,
} from '@deepseek-ai/dsh-agent'
import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  type ContentBlock,
} from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import {
  SessionPreparation,
  type Session,
  type SessionId,
  type UserMessage,
  type TurnEndReason,
} from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { registerRuntimeControl, runtimeSelection, type RuntimeSelection } from '@hulala/dsh-agent-loop-selector'
import type {} from '@hulala/dsh-network-proxy'

declare module '@deepseek-ai/dsh-llm' {
  interface AssistantProvenance {
    /** Native Agent Loop plugin that produced this message. */
    runtime?: string
  }
}

interface PiModelView {
  provider: string
  providerName: string
  id: string
  name: string
  default?: boolean
  thinkingLevels: string[]
  defaultThinkingLevel: string
}

export interface PiAuthProviderView {
  id: string
  name: string
  oauthName: string
  authenticated: boolean
  usingOAuth: boolean
  authType?: 'api_key' | 'oauth'
  source?: string
}

export interface PiAuthFlowView {
  id: string
  provider: string
  status: 'running' | 'completed' | 'error' | 'cancelled'
  event?: AuthEvent
  prompt?: PiAuthPromptView
  error?: string
}

type PiAuthPromptView =
  | { type: 'text' | 'secret' | 'manual_code'; message: string; placeholder?: string }
  | { type: 'select'; message: string; options: readonly { id: string; label: string; description?: string }[] }

interface PiAuthFlow extends PiAuthFlowView {
  controller: AbortController
  answer?: { resolve(value: string): void; reject(error: Error): void }
}

const webAuthProviders = new Set(['openai-codex', 'anthropic'])

declare module '@deepseek-ai/cordis' {
  interface Context {
    piAgentLoop: PiAgentLoop
  }
}

/** Keep an unpublished Harness Session reserved through asynchronous publish. */
export async function withSessionPreparation<T>(
  preparation: SessionPreparation,
  publish: (session: Session) => Promise<T>,
): Promise<T> {
  using ownedPreparation = preparation
  return await publish(ownedPreparation.session)
}

function textOf(message: UserMessage): string {
  return message.content.map((block) => {
    if (block.type === 'text') return block.text
    if (block.type === 'reasoning') return block.text
    return block.type === 'image' ? '[image]' : ''
  }).filter(Boolean).join('\n')
}

function piResultContent(result: unknown): ContentBlock[] {
  if (result !== null && typeof result === 'object' && 'content' in result) {
    const content = (result as { content?: unknown }).content
    if (Array.isArray(content)) {
      const blocks = content.flatMap((block): ContentBlock[] => {
        if (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
          return [{ type: 'text', text: String((block as { text?: unknown }).text ?? '') }]
        }
        return []
      })
      if (blocks.length > 0) return blocks
    }
  }
  return [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }]
}

interface PiAssistantMessage {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'thinking'; thinking: string }
    | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }
  >
}

function assistantBlocks(message: PiAssistantMessage): ContentBlock[] {
  return message.content.flatMap((block): ContentBlock[] => {
    if (block.type === 'text') return [{ type: 'text', text: block.text }]
    if (block.type === 'thinking') return [{ type: 'reasoning', text: block.thinking }]
    if (block.type === 'toolCall') {
      return [{
        type: 'tool-call',
        id: CallId(block.id),
        name: block.name,
        arguments: JSON.stringify(block.arguments),
      }]
    }
    return []
  })
}

export interface HarnessSdkSession {
  readonly runtime: string
  readonly model?: { provider: string; id: string }
  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  prompt(text: string): Promise<void>
  steer(text: string): Promise<void>
  followUp(text: string): Promise<void>
  abort(): Promise<void>
  dispose(): void
}

export class HarnessSdkAgent implements Agent {
  readonly scope: Scope
  readonly ctx: Context
  readonly inbox: Inbox
  private state: AgentStatus = 'idle'
  private activity: Promise<void> = Promise.resolve()
  private abortController: AbortController | undefined
  private disposed = false
  private turn = 0
  private step = 0

  constructor(
    private readonly rootCtx: Context,
    readonly id: SessionId,
    readonly options: AgentOptions,
    readonly session: Session,
    private readonly pi: HarnessSdkSession,
  ) {
    this.scope = createScope(rootCtx, this)
    this.ctx = this.scope.ctx.extend({ agent: this })
    const dispatch = agentEvents(rootCtx, this)
    this.inbox = new Inbox(session, {
      inserted: message => dispatch.emit('agent/inbox/inserted', { message }),
      discarded: message => dispatch.emit('agent/inbox/discarded', { message }),
      claimed: (message, turn) => dispatch.emit('agent/inbox/claimed', { message, turn }),
    })
    this.turn = session.events.findLast(event => event.type === 'turn/start')?.data.turn ?? 0
    this.pi.subscribe(event => this.onPiEvent(event))
  }

  get status(): AgentStatus { return this.state }

  private setStatus(status: AgentStatus): void {
    if (status === this.state) return
    this.state = status
    emitAgentEvent(this.rootCtx, this, 'agent/status', { status })
  }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    if (this.disposed) throw new Error(`agent "${this.id}" is disposed`)
    this.inbox.append(target, message)
    if (!wakeup) return
    if (this.status === 'running') {
      if (target === 'next-step') {
        const claimed = this.inbox.claim('next-step', this.turn)
        for (const steering of claimed) {
          this.session.append('user/message', steering, { surfaceOp: 'append' })
          void this.pi.steer(textOf(steering))
        }
      }
      return
    }
    this.start()
  }

  followup(message: UserMessage): void { this.send(message, 'next-turn', true) }
  steer(message: UserMessage): void { this.send(message, 'next-step', true) }
  inject(message: UserMessage): void { this.send(message, 'next-step', false) }

  cancel(cause: AgentCancelCause, options: CancelOptions = {}): void {
    if (!options.keepInbox) this.inbox.clear()
    this.abortController?.abort(cause)
    void this.pi.abort()
  }

  whenIdle(): Promise<void> { return this.activity }

  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.status !== 'idle') throw new Error(`agent "${this.id}" already has active work`)
    const controller = new AbortController()
    this.abortController = controller
    const job = task(controller.signal)
    this.activity = job.then(() => undefined, () => undefined)
    return job.finally(() => { this.abortController = undefined })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.cancel({ kind: 'disposed' })
    await this.whenIdle()
    this.pi.dispose()
    await this.scope.dispose()
  }

  private start(): void {
    if (this.status === 'running' || this.disposed) return
    this.setStatus('running')
    const controller = this.abortController = new AbortController()
    this.activity = this.rootCtx.agents.withInitiator(this, async () => {
      try {
        while (this.inbox.hasPending && !controller.signal.aborted) {
          await this.runTurn(controller.signal)
        }
      } catch (error) {
        emitAgentEvent(this.rootCtx, this, 'agent/error', { turn: this.turn, step: this.step, error })
      } finally {
        this.abortController = undefined
        this.setStatus('idle')
      }
    })
  }

  private async runTurn(signal: AbortSignal): Promise<void> {
    const turn = ++this.turn
    this.step = 0
    this.session.append('turn/start', { turn })
    let reason: TurnEndReason = { kind: 'completed' }
    try {
      const claimed = this.inbox.claim('next-turn', turn)
      for (const message of claimed) this.session.append('user/message', message, { surfaceOp: 'append' })
      signal.throwIfAborted()
      const prompt = claimed.map(textOf).filter(Boolean).join('\n\n')
      if (prompt.length > 0) await this.pi.prompt(prompt)
    } catch (error) {
      if (signal.aborted) reason = { kind: 'aborted', reason: signal.reason as AgentCancelCause }
      else reason = { kind: 'error', error: { message: error instanceof Error ? error.message : String(error), code: 'PI_RUNTIME' } }
      throw error
    } finally {
      if (this.step > 0) this.session.append('step/end', { turn, step: this.step })
      this.session.append('turn/end', { turn, reason })
    }
  }

  private onPiEvent(event: AgentSessionEvent): void {
    if (this.status !== 'running') return
    if (event.type === 'turn_start') {
      if (this.step > 0) this.session.append('step/end', { turn: this.turn, step: this.step })
      this.step += 1
      this.session.append('step/start', { turn: this.turn, step: this.step })
      return
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const message = event.message
      const content = assistantBlocks(message as PiAssistantMessage)
      this.session.append('assistant/message', {
        turn: this.turn,
        step: this.step,
        message: createAssistantMessage({
          content,
          source: { runtime: this.pi.runtime, provider: message.provider, model: message.model },
        }),
        usage: {
          inputTokens: message.usage.input,
          outputTokens: message.usage.output,
          cacheReadTokens: message.usage.cacheRead,
          cacheWriteTokens: message.usage.cacheWrite,
          ...(message.usage.reasoning === undefined ? {} : { reasoningTokens: message.usage.reasoning }),
        },
      }, { surfaceOp: 'append' })
      return
    }
    if (event.type === 'tool_execution_start') {
      this.session.append('tool/call', {
        turn: this.turn,
        step: this.step,
        callId: CallId(event.toolCallId),
        name: event.toolName,
        arguments: JSON.stringify(event.args),
      })
      return
    }
    if (event.type === 'tool_execution_end') {
      this.session.append('tool/result', {
        turn: this.turn,
        step: this.step,
        message: createToolResultMessage({
          callId: CallId(event.toolCallId),
          content: piResultContent(event.result),
          isError: event.isError,
        }),
      }, { surfaceOp: 'append' })
    }
  }
}

export class PiAgentLoop extends Service implements AgentFactory {
  static inject = ['agents', 'sessions', 'webServer', 'networkProxy']
  static Config = z.object({})

  private readonly modelRuntimePromise = ModelRuntime.create()
  private readonly handles = new Set<AgentHandle>()
  private readonly nativeSessions = new Set<AgentSession>()
  private readonly authFlows = new Map<string, PiAuthFlow>()

  constructor(ctx: Context) {
    super(ctx, 'piAgentLoop')
    ctx.effect(() => registerRuntimeControl('pi', this), 'piAgentLoop.control()')
    ctx.effect(() => ctx.agents.setFactory(this), 'piAgentLoop.setFactory()')
    this.installWebApi()
    ctx.effect(() => async () => {
      for (const flow of this.authFlows.values()) flow.controller.abort()
      await Promise.all([...this.handles].map(handle => handle.dispose()))
    }, 'piAgentLoop.sessions()')
  }

  async models(): Promise<PiModelView[]> {
    const runtime = await this.modelRuntimePromise
    const settings = SettingsManager.create(process.cwd())
    const defaultProvider = settings.getDefaultProvider()
    const defaultModel = settings.getDefaultModel()
    const defaultThinkingLevel = settings.getDefaultThinkingLevel() ?? 'medium'
    return (await runtime.getAvailable()).map(model => ({
      provider: model.provider,
      providerName: runtime.getProvider(model.provider)?.name ?? model.provider,
      id: model.id,
      name: model.name ?? model.id,
      thinkingLevels: getSupportedThinkingLevels(model),
      defaultThinkingLevel: clampThinkingLevel(model, defaultThinkingLevel as ModelThinkingLevel),
      ...(model.provider === defaultProvider && model.id === defaultModel ? { default: true } : {}),
    }))
  }

  async configure(selection: RuntimeSelection): Promise<void> {
    if (selection.provider === undefined || selection.model === undefined) return
    const modelRuntime = await this.modelRuntimePromise
    const model = modelRuntime.getModel(selection.provider, selection.model)
    if (model === undefined) throw new Error(`Pi model "${selection.provider}/${selection.model}" is not available`)
    if ([...this.nativeSessions].some(session => !session.isIdle)) {
      throw new Error('Wait for the current Pi turn to finish before changing model or Thinking Level.')
    }
    for (const session of this.nativeSessions) {
      if (session.model?.provider !== model.provider || session.model.id !== model.id) await session.setModel(model)
      if (selection.thinkingLevel !== undefined) session.setThinkingLevel(selection.thinkingLevel as ModelThinkingLevel)
    }
  }

  async authState(): Promise<{ providers: PiAuthProviderView[]; flows: PiAuthFlowView[] }> {
    const runtime = await this.modelRuntimePromise
    const providers = await Promise.all(runtime.getProviders()
      .filter(provider => webAuthProviders.has(provider.id) && provider.auth.oauth !== undefined)
      .map(async (provider): Promise<PiAuthProviderView> => {
        const status = await runtime.checkAuth(provider.id)
        return {
          id: provider.id,
          name: provider.name,
          oauthName: provider.auth.oauth?.name ?? 'OAuth',
          authenticated: status !== undefined,
          usingOAuth: status?.type === 'oauth',
          ...(status === undefined ? {} : { authType: status.type, source: status.source }),
        }
      }))
    return { providers, flows: [...this.authFlows.values()].map(flow => this.flowView(flow)) }
  }

  async startLogin(providerId: string): Promise<PiAuthFlowView> {
    const runtime = await this.modelRuntimePromise
    const provider = runtime.getProvider(providerId)
    if (!webAuthProviders.has(providerId) || provider?.auth.oauth === undefined) {
      throw new Error(`Pi OAuth provider "${providerId}" is not available`)
    }
    for (const flow of this.authFlows.values()) {
      if (flow.provider !== providerId) continue
      if (flow.status === 'running') flow.controller.abort()
      this.authFlows.delete(flow.id)
    }
    const flow: PiAuthFlow = {
      id: crypto.randomUUID(),
      provider: providerId,
      status: 'running',
      controller: new AbortController(),
    }
    this.authFlows.set(flow.id, flow)
    void runtime.login(providerId, 'oauth', {
      signal: flow.controller.signal,
      notify: event => { flow.event = event },
      prompt: prompt => this.waitForAuthAnswer(flow, prompt),
    }).then(() => {
      flow.status = 'completed'
      flow.prompt = undefined
      flow.answer = undefined
      flow.event = { type: 'info', message: `${provider.name} login completed.` }
    }, (error: unknown) => {
      flow.status = flow.controller.signal.aborted ? 'cancelled' : 'error'
      flow.prompt = undefined
      flow.answer = undefined
      if (flow.status === 'cancelled') {
        flow.event = { type: 'info', message: 'Login cancelled.' }
        flow.error = undefined
      } else {
        flow.error = error instanceof Error ? error.message : String(error)
      }
    })
    return this.flowView(flow)
  }

  answerLogin(flowId: string, value: string): PiAuthFlowView {
    const flow = this.requireFlow(flowId)
    if (flow.status !== 'running' || flow.prompt === undefined || flow.answer === undefined) {
      throw new Error('Pi login flow is not waiting for input')
    }
    if (flow.prompt.type === 'select' && !flow.prompt.options.some(option => option.id === value)) {
      throw new Error('invalid Pi login selection')
    }
    const answer = flow.answer
    flow.answer = undefined
    flow.prompt = undefined
    answer.resolve(value)
    return this.flowView(flow)
  }

  cancelLogin(flowId: string): PiAuthFlowView {
    const flow = this.requireFlow(flowId)
    flow.controller.abort()
    flow.status = 'cancelled'
    flow.prompt = undefined
    flow.answer = undefined
    flow.event = { type: 'info', message: 'Login cancelled.' }
    const view = this.flowView(flow)
    this.authFlows.delete(flow.id)
    return view
  }

  async logout(providerId: string): Promise<void> {
    if (!webAuthProviders.has(providerId)) throw new Error(`unsupported Pi OAuth provider "${providerId}"`)
    for (const flow of this.authFlows.values()) {
      if (flow.provider !== providerId) continue
      if (flow.status === 'running') flow.controller.abort()
      this.authFlows.delete(flow.id)
    }
    const runtime = await this.modelRuntimePromise
    await runtime.logout(providerId)
  }

  private waitForAuthAnswer(flow: PiAuthFlow, prompt: AuthPrompt): Promise<string> {
    if (flow.controller.signal.aborted || prompt.signal?.aborted) return Promise.reject(new Error('Login cancelled'))
    const { signal: _promptSignal, ...promptView } = prompt
    flow.prompt = promptView
    return new Promise<string>((resolve, reject) => {
      const cancel = () => {
        if (flow.answer?.resolve !== resolve) return
        flow.answer = undefined
        flow.prompt = undefined
        reject(new Error('Login prompt cancelled'))
      }
      flow.answer = { resolve, reject }
      flow.controller.signal.addEventListener('abort', cancel, { once: true })
      prompt.signal?.addEventListener('abort', cancel, { once: true })
    })
  }

  private requireFlow(flowId: string): PiAuthFlow {
    const flow = this.authFlows.get(flowId)
    if (flow === undefined) throw new Error('unknown Pi login flow')
    return flow
  }

  private flowView(flow: PiAuthFlow): PiAuthFlowView {
    return {
      id: flow.id,
      provider: flow.provider,
      status: flow.status,
      ...(flow.event === undefined ? {} : { event: flow.event }),
      ...(flow.prompt === undefined ? {} : { prompt: flow.prompt }),
      ...(flow.error === undefined ? {} : { error: flow.error }),
    }
  }

  private installWebApi(): void {
    const send = (res: import('node:http').ServerResponse, status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact', path: '/api/hulala/pi', handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            send(res, 200, { models: await this.models(), auth: await this.authState() })
            return
          }
          if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return }
          if (req.headers['sec-fetch-site'] === 'cross-site') { send(res, 403, { error: 'cross-site request rejected' }); return }
          if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
            send(res, 415, { error: 'content type must be application/json' }); return
          }
          let body = ''
          for await (const chunk of req) {
            body += String(chunk)
            if (body.length > 16_384) { send(res, 413, { error: 'request too large' }); return }
          }
          const input = JSON.parse(body) as { action?: unknown; provider?: unknown; flowId?: unknown; value?: unknown }
          if (input.action === 'login' && typeof input.provider === 'string') await this.startLogin(input.provider)
          else if (input.action === 'logout' && typeof input.provider === 'string') await this.logout(input.provider)
          else if (input.action === 'auth-input' && typeof input.flowId === 'string' && typeof input.value === 'string') this.answerLogin(input.flowId, input.value)
          else if (input.action === 'auth-cancel' && typeof input.flowId === 'string') this.cancelLogin(input.flowId)
          else { send(res, 400, { error: 'invalid Pi authentication action' }); return }
          send(res, 200, { models: await this.models(), auth: await this.authState() })
        } catch (error) {
          send(res, 409, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'piAgentLoop.webApi()')
  }

  async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
    const preparation = SessionPreparation.create(this.ctx.sessions.prepare(options.sessionId, {
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(options.meta === undefined ? {} : { meta: options.meta }),
    }))
    return withSessionPreparation(preparation, session =>
      this.createFromSession(ownerCtx, session, options.agentOptions ?? {}, options.setup, false))
  }

  async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) throw new Error('cannot resume: session persistence is not configured')
    const preparation = await persistence.prepare(options.resumeSessionId, options.signal)
    return withSessionPreparation(preparation, session =>
      this.createFromSession(ownerCtx, session, options.agentOptions ?? {}, options.setup, true))
  }

  private async createFromSession(
    ownerCtx: Context,
    session: Session,
    options: AgentOptions,
    setup: AgentSetup | undefined,
    resume: boolean,
  ): Promise<AgentHandle> {
    ownerCtx.fiber.assertActive()
    const cwd = session.header.cwd ?? process.cwd()
    const modelRuntime = await this.modelRuntimePromise
    let piSessionManager: SessionManager
    if (resume) {
      const existing = (await SessionManager.list(cwd)).find(info => info.id === session.id)
      piSessionManager = existing === undefined
        ? SessionManager.create(cwd, undefined, { id: session.id })
        : SessionManager.open(existing.path, undefined, cwd)
    } else {
      piSessionManager = SessionManager.create(cwd, undefined, { id: session.id })
    }
    const selected = runtimeSelection()
    const provider = selected.runtime === 'pi' ? selected.provider : undefined
    const model = selected.runtime === 'pi' ? selected.model : undefined
    const thinkingLevel = selected.runtime === 'pi' ? selected.thinkingLevel as ModelThinkingLevel | undefined : undefined
    const requested = provider && model
      ? modelRuntime.getModel(provider, model)
      : undefined
    const { session: pi } = await createAgentSession({
      cwd,
      modelRuntime,
      sessionManager: piSessionManager,
      ...(requested === undefined ? {} : { model: requested }),
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    })
    const native = Object.assign(pi, { runtime: 'pi' as const })
    const agent = new HarnessSdkAgent(this.ctx, session.id, {
      provider: pi.model?.provider ?? options.provider,
      model: pi.model?.id ?? options.model,
      maxTokens: options.maxTokens,
    }, session, native)
    await pi.bindExtensions({ uiContext: this.extensionUi(agent), mode: 'print' })

    let detachSession: (() => void) | undefined
    let detachAgent: (() => void) | undefined
    let disposed: Promise<void> | undefined
    const handle: AgentHandle = {
      agent,
      dispose: () => (disposed ??= (async () => {
        await agent.dispose()
        this.nativeSessions.delete(pi)
        detachAgent?.()
        detachSession?.()
        this.handles.delete(handle)
      })()),
    }
    try {
      const commit = await setup?.(agent.ctx)
      commit?.commit()
      detachSession = agent.ctx.sessions.enter(session)
      detachAgent = this.ctx.agents.enter(agent, ownerCtx.agent)
      agent.ctx.sessions.announce(session)
      this.ctx.agents.announce(agent)
      emitAgentEvent(this.ctx, agent, 'agent/session-start', { source: resume ? 'resume' : 'startup' })
      this.handles.add(handle)
      this.nativeSessions.add(pi)
      ownerCtx.effect(() => () => handle.dispose(), `piAgentLoop.lifecycle(${session.id})`)
      return handle
    } catch (error) {
      await handle.dispose()
      throw error
    }
  }

  private extensionUi(agent: Agent): ExtensionUIContext {
    const ask = async (title: string, options: string[], detail?: string): Promise<string | undefined> => {
      const service = agent.ctx.get('userQuestions')
      if (service === undefined) return undefined
      const id = `pi-${crypto.randomUUID()}`
      const answer = await service.ask({
        agent,
        questions: [{
          id,
          header: title,
          question: detail ?? title,
          options: options.map(label => ({ label, description: label })),
        }],
      })
      const item = answer.answers.find((candidate: { id: string; selected: string[]; custom?: string }) => candidate.id === id)
      return item?.selected[0] ?? item?.custom
    }
    return {
      select: (title, options) => ask(title, options),
      confirm: async (title, message) => (await ask(title, ['Yes', 'No'], message)) === 'Yes',
      input: async (title, placeholder) => ask(title, [placeholder ?? 'Enter value']),
      notify: (message, type) => this.ctx.logger[type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'info'](message),
      onTerminalInput: () => () => {},
      setStatus: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: () => {},
      setFooter: () => {},
      setHeader: () => {},
      setTitle: () => {},
      custom: () => Promise.reject(new Error('terminal extension components are unavailable in the Harness Web surface')),
      pasteToEditor: () => {},
      setEditorText: () => {},
      getEditorText: () => '',
      editor: async (_title, prefill) => prefill,
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: 'theme changes belong to the Harness Web surface' }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
      get theme() { return undefined as never },
    }
  }
}

export default PiAgentLoop
