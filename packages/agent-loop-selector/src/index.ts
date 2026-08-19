import { Context, Service } from '@deepseek-ai/cordis'
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EntryOptions, EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'

export interface RuntimeDescriptor {
  name: string
  package: string
}

export interface Config {
  defaultRuntime: string
  entryId: string
  runtimes: Record<string, RuntimeDescriptor>
}

export interface RuntimeState extends RuntimeDescriptor {
  id: string
  active: boolean
}

export interface RuntimeSelection {
  runtime: string
  provider?: string
  model?: string
  thinkingLevel?: string
}

export interface RuntimeModel {
  provider: string
  providerName?: string
  id: string
  name: string
  default?: boolean
  thinkingLevels?: string[]
  defaultThinkingLevel?: string
}

export interface RuntimeControl {
  models(): Promise<RuntimeModel[]>
  configure?(selection: RuntimeSelection): Promise<void>
  authState?(): Promise<unknown>
  startLogin?(providerId: string): Promise<unknown>
  answerLogin?(flowId: string, value: string): unknown
  cancelLogin?(flowId: string): unknown
  logout?(providerId: string): Promise<void>
}

const selectionKey = Symbol.for('hulala.agent-runtime-selection')
const controlsKey = Symbol.for('hulala.agent-runtime-controls')
const processStartedAt = new Date().toISOString()

export interface HulalaHealth {
  name: 'hulala'
  version: string
  pid: number
  startedAt: string
}

export function healthPayload(
  version = process.env.HULALA_VERSION ?? '0.1.0',
  pid = process.pid,
  startedAt = processStartedAt,
): HulalaHealth {
  return { name: 'hulala', version, pid, startedAt }
}

export function defaultWorkspacePath(userHome?: string): string {
  return userHome
    ? join(userHome, '.config', 'hulala', 'workspace')
    : join(process.env.HULALA_HOME ?? join(homedir(), '.config', 'hulala'), 'workspace')
}

export async function ensureDefaultWorkspace(
  registry: Pick<Context['workspaceRegistry'], 'list' | 'create'>,
  userHome?: string,
  createDirectory: (path: string, options: { recursive: true }) => Promise<unknown> = mkdir,
): Promise<string | undefined> {
  if (registry.list().length > 0) return undefined
  const path = defaultWorkspacePath(userHome)
  await createDirectory(path, { recursive: true })
  // Re-check after the asynchronous filesystem operation so a workspace added
  // concurrently by another startup participant always wins.
  if (registry.list().length > 0) return undefined
  await registry.create(path)
  return path
}

function runtimeControls(): Map<string, RuntimeControl> {
  const root = globalThis as Record<PropertyKey, unknown>
  let controls = root[controlsKey] as Map<string, RuntimeControl> | undefined
  if (controls === undefined) root[controlsKey] = controls = new Map()
  return controls
}

export function registerRuntimeControl(runtime: string, control: RuntimeControl): () => void {
  runtimeControls().set(runtime, control)
  return () => {
    if (runtimeControls().get(runtime) === control) runtimeControls().delete(runtime)
  }
}

export function runtimeSelection(): RuntimeSelection {
  return (globalThis as Record<PropertyKey, unknown>)[selectionKey] as RuntimeSelection
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentLoopSelector: AgentLoopSelector
  }
}

/**
 * Owns the single process-wide AgentFactory choice. Replacing the Loader entry
 * unloads the old runtime first, which drains its Agent handles and persisted
 * Session state before the new factory resumes the current conversation.
 */
export class AgentLoopSelector extends Service {
  static inject = ['loader', 'webServer', 'workspaceRegistry']

  static Config = z.object({
    defaultRuntime: z.string().default('pi'),
    entryId: z.string().default('agent-loop'),
    runtimes: z.dict(z.object({
      name: z.string().required(),
      package: z.string().required(),
    })).required(),
  }) as z<Config>

  private activeRuntime: string
  private updateChain: Promise<void> = Promise.resolve()
  private readonly tree: EntryTree

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'agentLoopSelector')
    if (!(config.defaultRuntime in config.runtimes)) {
      throw new Error(`unknown default agent runtime "${config.defaultRuntime}"`)
    }
    this.tree = ctx.fiber.entry?.parent.tree ?? ctx.loader
    const entry = this.tree.resolve(config.entryId)
    this.activeRuntime = Object.entries(config.runtimes)
      .find(([, descriptor]) => descriptor.package === entry.options.name)?.[0]
      ?? config.defaultRuntime
    ;(globalThis as Record<PropertyKey, unknown>)[selectionKey] = { runtime: this.activeRuntime }
    this.installWebSurface()
  }

  protected async [Service.init](): Promise<void> {
    await ensureDefaultWorkspace(this.ctx.workspaceRegistry)
  }

  current(): string {
    return this.activeRuntime
  }

  selectModel(provider: string | undefined, model: string | undefined, thinkingLevel?: string): void {
    ;(globalThis as Record<PropertyKey, unknown>)[selectionKey] = {
      runtime: this.activeRuntime,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    }
  }

  list(): RuntimeState[] {
    return Object.entries(this.config.runtimes).map(([id, descriptor]) => ({
      id,
      ...descriptor,
      active: id === this.activeRuntime,
    }))
  }

  activate(runtime: string): Promise<void> {
    const task = this.updateChain.then(() => this.activateNow(runtime))
    this.updateChain = task.catch(() => undefined)
    return task
  }

  private async activateNow(runtime: string): Promise<void> {
    const target = this.config.runtimes[runtime]
    if (target === undefined) throw new Error(`unknown agent runtime "${runtime}"`)
    const entry = this.tree.resolve(this.config.entryId)
    if (entry.options.name === target.package) {
      this.activeRuntime = runtime
      ;(globalThis as Record<PropertyKey, unknown>)[selectionKey] = { runtime }
      return
    }

    // Entry.update accepts Partial<EntryOptions>; EntryTree.update's narrower
    // public type intentionally hides `name`, although replacement is a native
    // Entry operation. Calling the entry keeps the upstream transactional
    // import/dispose/rollback behavior intact.
    await entry.update({ name: target.package } satisfies Partial<EntryOptions>, false, true)
    this.activeRuntime = runtime
    ;(globalThis as Record<PropertyKey, unknown>)[selectionKey] = { runtime }
  }


  private installWebSurface(): void {
    const runtimeService = (): RuntimeControl | undefined => runtimeControls().get(this.activeRuntime)
    const send = (res: import('node:http').ServerResponse, status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact', path: '/api/hulala/health', handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, { error: 'method not allowed' }); return }
        const payload = JSON.stringify(healthPayload())
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(req.method === 'HEAD' ? undefined : payload)
      },
    }), 'agentLoopSelector.health()')
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact', path: '/api/hulala/runtimes', handler: async (req, res) => {
        try {
        if (req.method === 'GET') {
          const service = runtimeService()
          let models: unknown[] = []
          let modelError: string | undefined
          if (service !== undefined) {
            try { models = await service.models() } catch (error) { modelError = error instanceof Error ? error.message : String(error) }
          }
          const auth = await service?.authState?.()
          if (this.activeRuntime === 'pi' && models.length === 0 && modelError === undefined) {
            modelError = 'No Pi models are currently available. Sign in below, run `pi` then `/login`, or configure a provider in ~/.pi/agent.'
          }
          send(res, 200, { current: this.activeRuntime, selection: runtimeSelection(), runtimes: this.list(), models, modelError, auth })
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
        try {
          const input = JSON.parse(body) as {
            runtime?: unknown
            provider?: unknown
            model?: unknown
            thinkingLevel?: unknown
            action?: unknown
            flowId?: unknown
            value?: unknown
          }
          if (typeof input.runtime === 'string' && input.runtime !== this.activeRuntime) await this.activate(input.runtime)
          if (typeof input.action === 'string') {
            const service = runtimeService()
            if (this.activeRuntime !== 'pi' || service === undefined) throw new Error('Pi must be the active runtime')
            if (input.action === 'login' && typeof input.provider === 'string' && service.startLogin !== undefined) {
              await service.startLogin(input.provider)
            } else if (input.action === 'logout' && typeof input.provider === 'string' && service.logout !== undefined) {
              await service.logout(input.provider)
            } else if (input.action === 'auth-input' && typeof input.flowId === 'string' && typeof input.value === 'string' && service.answerLogin !== undefined) {
              service.answerLogin(input.flowId, input.value)
            } else if (input.action === 'auth-cancel' && typeof input.flowId === 'string' && service.cancelLogin !== undefined) {
              service.cancelLogin(input.flowId)
            } else {
              throw new Error('invalid Pi authentication action')
            }
            send(res, 200, { current: this.activeRuntime, selection: runtimeSelection(), auth: await service.authState?.() })
            return
          }
          const provider = typeof input.provider === 'string' ? input.provider : undefined
          const model = typeof input.model === 'string' ? input.model : undefined
          const thinkingLevel = typeof input.thinkingLevel === 'string' ? input.thinkingLevel : undefined
          const service = runtimeService()
          if (provider !== undefined && model !== undefined) {
            const descriptor = (await service?.models())?.find(candidate => candidate.provider === provider && candidate.id === model)
            if (descriptor === undefined && service !== undefined) throw new Error(`model "${provider}/${model}" is not available`)
            if (thinkingLevel !== undefined && !descriptor?.thinkingLevels?.includes(thinkingLevel)) {
              throw new Error(`thinking level "${thinkingLevel}" is not available for ${provider}/${model}`)
            }
          } else if (thinkingLevel !== undefined) {
            throw new Error('a model is required when selecting a thinking level')
          }
          await service?.configure?.({ runtime: this.activeRuntime, provider, model, thinkingLevel })
          this.selectModel(provider, model, thinkingLevel)
          send(res, 200, { current: this.activeRuntime, selection: runtimeSelection() })
        } catch (error) {
          send(res, 409, { error: error instanceof Error ? error.message : String(error) })
        }
        } catch (error) {
          send(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'agentLoopSelector.webApi()')

    const clientPath = new URL('./client/runtime-ui.js', import.meta.url)
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact', path: '/hulala/runtime-ui.js', handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
        try {
          const body = await readFile(clientPath)
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(req.method === 'HEAD' ? undefined : body)
        } catch (error) {
          send(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'agentLoopSelector.webUiBundle()')
    const devBase = process.env.HULALA_UI_DEV_URL?.replace(/\/$/, '')
    const clientUrl = devBase === undefined ? '/hulala/runtime-ui.js' : `${devBase}/src/client.ts`
    const script = `<script type="module" src="${clientUrl}"></script>`
    this.ctx.effect(() => this.ctx.webServer.tapIndex(html => html.replace('</body>', `${script}</body>`)), 'agentLoopSelector.webUi()')
  }
}

export default AgentLoopSelector
