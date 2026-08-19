import { query, type CanUseTool, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
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
import { runtimeSelection } from '@hulala/dsh-agent-loop-selector'
import type {} from '@hulala/dsh-network-proxy'

type Listener = Parameters<HarnessSdkSession['subscribe']>[0]

class ClaudeSdkSession implements HarnessSdkSession {
  readonly runtime = 'claude'
  readonly model: { provider: string; id: string }
  private readonly listeners = new Set<Listener>()
  private active: Query | undefined
  private abortController: AbortController | undefined
  private resumeId: string | undefined
  private agent: Agent | undefined
  private bindingLogged = false

  constructor(
    model: string,
    private readonly cwd: string,
    private readonly env: () => Record<string, string>,
    private readonly onSessionId: (id: string) => void,
    resumeId?: string,
  ) {
    this.model = { provider: 'anthropic', id: model }
    this.resumeId = resumeId
    this.bindingLogged = resumeId !== undefined
  }

  bindAgent(agent: Agent): void { this.agent = agent }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private emit(event: Parameters<Listener>[0]): void { for (const listener of this.listeners) listener(event) }

  async prompt(text: string): Promise<void> {
    const abortController = this.abortController = new AbortController()
    this.emit({ type: 'turn_start' })
    const canUseTool: CanUseTool = async (toolName, input, options) => {
      const agent = this.agent
      const questions = agent?.ctx.get('userQuestions')
      if (agent === undefined || questions === undefined) {
        return { behavior: 'deny', message: 'No Harness approval UI is connected.' }
      }
      const id = `claude-${crypto.randomUUID()}`
      const answer = await questions.ask({
        agent,
        signal: options.signal,
        questions: [{
          id,
          header: options.displayName ?? toolName,
          question: options.title ?? options.decisionReason ?? `Allow ${toolName}?`,
          detail: JSON.stringify(input, null, 2),
          options: [
            { label: 'Allow', description: 'Allow this tool call once.' },
            { label: 'Deny', description: 'Reject this tool call.' },
          ],
        }],
      })
      return answer.answers.find((candidate: { id: string; selected: string[] }) => candidate.id === id)?.selected[0] === 'Allow'
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'Denied by user.' }
    }
    this.active = query({
      prompt: text,
      options: {
        abortController,
        cwd: this.cwd,
        env: this.env(),
        ...(this.model.id === 'default' ? {} : { model: this.model.id }),
        ...(this.resumeId === undefined ? {} : { resume: this.resumeId }),
        persistSession: true,
        permissionMode: 'default',
        canUseTool,
        tools: { type: 'preset', preset: 'claude_code' },
        settingSources: ['user', 'project', 'local'],
      },
    })
    try {
      for await (const message of this.active) this.consume(message)
    } finally {
      this.active = undefined
      this.abortController = undefined
    }
  }

  async steer(text: string): Promise<void> { await this.prompt(text) }
  async followUp(text: string): Promise<void> { await this.prompt(text) }
  async abort(): Promise<void> { this.abortController?.abort(); this.active?.close() }
  dispose(): void { this.abortController?.abort(); this.active?.close() }

  private consume(message: SDKMessage): void {
    if ('session_id' in message && typeof message.session_id === 'string') {
      this.resumeId = message.session_id
      if (!this.bindingLogged) {
        this.onSessionId(message.session_id)
        this.bindingLogged = true
      }
    }
    if (message.type === 'system' && message.subtype === 'init') {
      this.model.id = message.model
      return
    }
    if (message.type === 'result' && message.is_error) {
      throw new Error('errors' in message ? message.errors.join('; ') : `Claude Code ended with ${message.subtype}`)
    }
    if (message.type === 'assistant') {
      const content = message.message.content.flatMap((block): Array<Record<string, unknown>> => {
        if (block.type === 'text') return [{ type: 'text', text: block.text }]
        if (block.type === 'thinking') return [{ type: 'thinking', thinking: block.thinking }]
        if (block.type === 'tool_use') return [{ type: 'toolCall', id: block.id, name: block.name, arguments: block.input }]
        return []
      })
      this.emit({
        type: 'message_end',
        message: {
          role: 'assistant', content: content as never,
          api: 'anthropic-messages', provider: 'anthropic', model: message.message.model,
          usage: {
            input: message.message.usage.input_tokens,
            output: message.message.usage.output_tokens,
            cacheRead: message.message.usage.cache_read_input_tokens ?? 0,
            cacheWrite: message.message.usage.cache_creation_input_tokens ?? 0,
            totalTokens: message.message.usage.input_tokens + message.message.usage.output_tokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: message.message.stop_reason === 'max_tokens' ? 'length' : 'stop', timestamp: Date.now(),
        },
      })
      for (const block of message.message.content) {
        if (block.type === 'tool_use') this.emit({ type: 'tool_execution_start', toolCallId: block.id, toolName: block.name, args: block.input })
      }
      return
    }
    if (message.type === 'user') {
      const body = message.message.content
      if (!Array.isArray(body)) return
      for (const block of body) {
        if (block.type !== 'tool_result') continue
        this.emit({
          type: 'tool_execution_end', toolCallId: block.tool_use_id, toolName: 'tool',
          result: block.content, isError: block.is_error ?? false,
        })
      }
    }
  }
}

export interface Config { model?: string }

export class ClaudeAgentLoop extends Service implements AgentFactory {
  static inject = ['agents', 'sessions', 'networkProxy']
  static Config = z.object({ model: z.string() }) as z<Config>
  private readonly handles = new Set<AgentHandle>()
  private readonly sessionIds = new Map<string, string>()

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'claudeAgentLoop')
    ctx.effect(() => ctx.agents.setFactory(this), 'claudeAgentLoop.setFactory()')
    ctx.effect(() => async () => { await Promise.all([...this.handles].map(handle => handle.dispose())) })
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
    const model = (selected.runtime === 'claude' ? selected.model : undefined)
      ?? this.config.model
      ?? 'default'
    const native = new ClaudeSdkSession(model, session.header.cwd ?? process.cwd(), () => this.ctx.networkProxy.childEnv(),
      id => this.sessionIds.set(session.id, id), resume ? this.sessionIds.get(session.id) : undefined)
    const agent = new HarnessSdkAgent(this.ctx, session.id, { provider: 'anthropic', model }, session, native)
    native.bindAgent(agent)
    let detachSession: (() => void) | undefined
    let detachAgent: (() => void) | undefined
    let disposing: Promise<void> | undefined
    const handle: AgentHandle = { agent, dispose: () => (disposing ??= (async () => {
      await agent.dispose(); detachAgent?.(); detachSession?.(); this.handles.delete(handle)
    })()) }
    try {
      const commit = await setup?.(agent.ctx); commit?.commit()
      detachSession = agent.ctx.sessions.enter(session); detachAgent = this.ctx.agents.enter(agent, ownerCtx.agent)
      agent.ctx.sessions.announce(session); this.ctx.agents.announce(agent)
      emitAgentEvent(this.ctx, agent, 'agent/session-start', { source: resume ? 'resume' : 'startup' })
      this.handles.add(handle)
      ownerCtx.effect(() => () => handle.dispose(), `claudeAgentLoop.lifecycle(${session.id})`)
      return handle
    } catch (error) { await handle.dispose(); throw error }
  }
}

export default ClaudeAgentLoop
