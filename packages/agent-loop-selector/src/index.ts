import { Context, Service } from '@deepseek-ai/cordis'
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EntryOptions, EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { type SettingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
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
  acceptsArbitraryModel?: boolean
  models(sessionId?: string): Promise<RuntimeModel[]>
  configure?(selection: RuntimeSelection, sessionId?: string): Promise<void>
  authState?(): Promise<unknown>
  startLogin?(providerId: string): Promise<unknown>
  answerLogin?(flowId: string, value: string): unknown
  cancelLogin?(flowId: string): unknown
  logout?(providerId: string): Promise<void>
}

const selectionKey = Symbol.for('hulala.agent-runtime-selection')
const controlsKey = Symbol.for('hulala.agent-runtime-controls')
const processStartedAt = new Date().toISOString()
export const RUNTIME_SELECTION_SETTINGS_NAMESPACE = 'hulala-agent-runtime' as SettingsNamespace

export const RuntimeSelectionSettingsSchema = z.object({
  runtime: z.string().required(),
  provider: z.string(),
  model: z.string(),
  thinkingLevel: z.string(),
}) as z<RuntimeSelection>

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
  if (process.env.HULALA_WORKSPACE_DIR) return process.env.HULALA_WORKSPACE_DIR
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

function normalizeSelection(value: RuntimeSelection, fallbackRuntime: string): RuntimeSelection {
  const runtime = typeof value.runtime === 'string' && value.runtime ? value.runtime : fallbackRuntime
  const provider = typeof value.provider === 'string' && value.provider ? value.provider : undefined
  const model = typeof value.model === 'string' && value.model ? value.model : undefined
  const thinkingLevel = typeof value.thinkingLevel === 'string' && value.thinkingLevel ? value.thinkingLevel : undefined
  return {
    runtime,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  }
}

function sameSelection(left: RuntimeSelection, right: RuntimeSelection): boolean {
  return left.runtime === right.runtime
    && left.provider === right.provider
    && left.model === right.model
    && left.thinkingLevel === right.thinkingLevel
}

function nativeRuntimeModels(groups: unknown): RuntimeModel[] {
  if (!Array.isArray(groups)) return []
  return groups.flatMap((rawGroup): RuntimeModel[] => {
    if (rawGroup === null || typeof rawGroup !== 'object') return []
    const group = rawGroup as { id?: unknown; name?: unknown; models?: unknown }
    if (typeof group.id !== 'string' || !Array.isArray(group.models)) return []
    return group.models.flatMap((rawModel): RuntimeModel[] => {
      if (rawModel === null || typeof rawModel !== 'object') return []
      const model = rawModel as {
        id?: unknown
        name?: unknown
        reasoning?: { efforts?: Array<{ id?: unknown }>; defaultEffort?: unknown }
      }
      if (typeof model.id !== 'string') return []
      const thinkingLevels = Array.isArray(model.reasoning?.efforts)
        ? model.reasoning.efforts.flatMap(effort => typeof effort.id === 'string' ? [effort.id] : [])
        : []
      return [{
        provider: group.id as string,
        providerName: typeof group.name === 'string' ? group.name : group.id as string,
        id: model.id,
        name: typeof model.name === 'string' ? model.name : model.id,
        ...(thinkingLevels.length > 0 ? { thinkingLevels } : {}),
        ...(typeof model.reasoning?.defaultEffort === 'string' ? { defaultThinkingLevel: model.reasoning.defaultEffort } : {}),
      }]
    })
  })
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
  static inject = ['loader', 'workspaceRegistry', 'settings', 'agentDefaultModel', 'typertGateway']

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
  private readonly selectionSettings: SettingsScope<RuntimeSelection>
  private restoreWarning: string | undefined

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
    this.selectionSettings = ctx.settings.register(
      RUNTIME_SELECTION_SETTINGS_NAMESPACE,
      RuntimeSelectionSettingsSchema,
      {
        base: { runtime: config.defaultRuntime },
        applies: 'live',
        validate: value => {
          if (!(value.runtime in config.runtimes)) throw new Error(`unknown agent runtime "${value.runtime}"`)
          if ((value.provider === undefined) !== (value.model === undefined)) {
            throw new Error('provider and model must be configured together')
          }
          if (value.thinkingLevel !== undefined && value.model === undefined) {
            throw new Error('a model is required when selecting a thinking level')
          }
        },
      },
    )
    ;(globalThis as Record<PropertyKey, unknown>)[selectionKey] = { runtime: this.activeRuntime }
    this.selectionSettings.watch(next => {
      void this.enqueueRestore(next).catch(error => {
        this.ctx.logger.warn(`agent-loop-selector: failed to apply updated user selection: ${String(error)}`)
      })
    })
    ctx.inject(['webServer'], webCtx => this.installWebSurface(webCtx))
  }

  protected async [Service.init](): Promise<void> {
    await this.enqueueRestore(this.selectionSettings.get())
    await ensureDefaultWorkspace(this.ctx.workspaceRegistry)
  }

  current(): string {
    return this.activeRuntime
  }

  async selectModel(provider: string | undefined, model: string | undefined, thinkingLevel?: string): Promise<void> {
    const next = {
      runtime: this.activeRuntime,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    }
    const task = this.updateChain.then(async () => {
      ;(globalThis as Record<PropertyKey, unknown>)[selectionKey] = next
      await this.persistSelection(next)
    })
    this.updateChain = task.catch(() => undefined)
    await task
  }

  list(): RuntimeState[] {
    return Object.entries(this.config.runtimes).map(([id, descriptor]) => ({
      id,
      ...descriptor,
      active: id === this.activeRuntime,
    }))
  }

  /** Return the active Runtime, selection, model directory, and auth state. */
  async describe(sessionId?: string): Promise<unknown> {
    const service = runtimeControls().get(this.activeRuntime)
    let models: unknown[] = []
    let modelError: string | undefined = this.restoreWarning
    let selection = runtimeSelection()
    if (service !== undefined) {
      try { models = await service.models(sessionId) } catch (error) { modelError = error instanceof Error ? error.message : String(error) }
    } else {
      try {
        const native = await this.nativeModelState(sessionId)
        models = native.models
        selection = native.selection
      } catch (error) {
        modelError = error instanceof Error ? error.message : String(error)
      }
    }
    const auth = await service?.authState?.()
    if (this.activeRuntime === 'pi' && models.length === 0 && modelError === undefined) {
      modelError = 'No Pi models are currently available. Sign in below, run `pi` then `/login`, or configure a provider in ~/.pi/agent.'
    }
    return { current: this.activeRuntime, selection, runtimes: this.list(), models, modelError, auth }
  }

  /** Apply one Runtime/model/auth selection request without assuming HTTP. */
  async select(input: Record<string, unknown>): Promise<unknown> {
    if (typeof input.runtime === 'string' && input.runtime !== this.activeRuntime) await this.activate(input.runtime)
    if (typeof input.action === 'string') {
      const service = runtimeControls().get(this.activeRuntime)
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
      return { current: this.activeRuntime, selection: runtimeSelection(), auth: await service.authState?.() }
    }
    const provider = typeof input.provider === 'string' ? input.provider : undefined
    const model = typeof input.model === 'string' ? input.model : undefined
    const thinkingLevel = typeof input.thinkingLevel === 'string' ? input.thinkingLevel : undefined
    const sessionId = typeof input.sessionId === 'string' && input.sessionId.trim() ? input.sessionId.trim() : undefined
    const service = runtimeControls().get(this.activeRuntime)
    if (provider !== undefined && model !== undefined) {
      const descriptor = (await service?.models(sessionId))?.find(candidate => candidate.provider === provider && candidate.id === model)
      if (descriptor === undefined && service !== undefined && service.acceptsArbitraryModel !== true) {
        throw new Error(`model "${provider}/${model}" is not available`)
      }
      if (thinkingLevel !== undefined && descriptor !== undefined && !descriptor.thinkingLevels?.includes(thinkingLevel)) {
        throw new Error(`thinking level "${thinkingLevel}" is not available for ${provider}/${model}`)
      }
    } else if (thinkingLevel !== undefined) {
      throw new Error('a model is required when selecting a thinking level')
    }
    const nextSelection = { runtime: this.activeRuntime, provider, model, thinkingLevel }
    if (service !== undefined) await service.configure?.(nextSelection, sessionId)
    else if (provider !== undefined && model !== undefined) await this.selectNativeModel(provider, model, thinkingLevel, sessionId)
    await this.selectModel(provider, model, thinkingLevel)
    this.restoreWarning = undefined
    return { current: this.activeRuntime, selection: runtimeSelection() }
  }

  activate(runtime: string): Promise<void> {
    const task = this.updateChain.then(async () => {
      await this.activateNow(runtime)
      await this.persistSelection({ runtime })
    })
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

  private async persistSelection(selection: RuntimeSelection): Promise<void> {
    try {
      await this.selectionSettings.replace(selection)
    } catch (error) {
      throw new Error(`Selection applied, but Harness could not remember it: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private enqueueRestore(selection: RuntimeSelection): Promise<void> {
    const task = this.updateChain.then(() => this.restoreSelection(selection))
    this.updateChain = task.catch(() => undefined)
    return task
  }

  private async restoreSelection(value: RuntimeSelection): Promise<void> {
    const saved = normalizeSelection(value, this.config.defaultRuntime)
    const latest = normalizeSelection(this.selectionSettings.get(), this.config.defaultRuntime)
    if (!sameSelection(saved, latest)) return
    const current = runtimeSelection()
    if (sameSelection(saved, current) && saved.runtime === this.activeRuntime) return
    await this.activateNow(saved.runtime)
    this.restoreWarning = undefined
    const service = runtimeControls().get(saved.runtime)
    if (saved.provider !== undefined && saved.model !== undefined && service !== undefined) {
      try {
        const models = await service.models()
        const descriptor = models.find(candidate => candidate.provider === saved.provider && candidate.id === saved.model)
        if (descriptor === undefined && service.acceptsArbitraryModel !== true) {
          this.restoreWarning = `Saved model "${saved.provider}/${saved.model}" is no longer available; using the ${saved.runtime} default.`
          return
        }
        if (saved.thinkingLevel !== undefined && descriptor !== undefined && !descriptor.thinkingLevels?.includes(saved.thinkingLevel)) {
          this.restoreWarning = `Saved thinking level "${saved.thinkingLevel}" is no longer available; using the model default.`
          const fallback = { runtime: saved.runtime, provider: saved.provider, model: saved.model }
          await service.configure?.(fallback)
          ;(globalThis as Record<PropertyKey, unknown>)[selectionKey] = fallback
          return
        }
        await service.configure?.(saved)
      } catch (error) {
        this.restoreWarning = `Saved selection could not be restored; using the ${saved.runtime} default. ${error instanceof Error ? error.message : String(error)}`
        return
      }
    }
    ;(globalThis as Record<PropertyKey, unknown>)[selectionKey] = saved
  }

  private async nativeModelState(sessionId?: string): Promise<{ models: RuntimeModel[]; selection: RuntimeSelection }> {
    const catalog = await this.ctx.typertGateway.invoke({
      namespace: 'session', method: 'modelCatalog', args: {},
    }) as { default: { provider: string; model: string; reasoningEffort?: string }; groups: unknown }
    let selected = catalog.default
    if (sessionId !== undefined) {
      const listing = await this.ctx.typertGateway.invoke({
        namespace: 'session', method: 'list', args: { _request: {} },
      }) as { items: Array<{ sessionId: string; projections?: { values?: { modelSelection?: { next?: typeof selected | null } } } }> }
      selected = listing.items.find(item => item.sessionId === sessionId)?.projections?.values?.modelSelection?.next ?? selected
    }
    return {
      models: nativeRuntimeModels(catalog.groups),
      selection: {
        runtime: this.activeRuntime,
        provider: selected.provider,
        model: selected.model,
        ...(selected.reasoningEffort ? { thinkingLevel: selected.reasoningEffort } : {}),
      },
    }
  }

  private async selectNativeModel(
    provider: string,
    model: string,
    thinkingLevel: string | undefined,
    sessionId: string | undefined,
  ): Promise<void> {
    if (sessionId === undefined) {
      await this.ctx.agentDefaultModel.saveSelection({
        provider,
        model,
        ...(thinkingLevel ? { reasoningEffort: thinkingLevel as never } : {}),
      })
      return
    }
    await this.ctx.typertGateway.invoke({
      namespace: 'session',
      method: 'selectModel',
      args: { request: {
        sessionId, provider, model,
        ...(thinkingLevel ? { reasoningEffort: thinkingLevel } : {}),
      } },
    })
  }


  private installWebSurface(ctx: Context): void {
    const send = (res: import('node:http').ServerResponse, status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path: '/api/hulala/health', handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, { error: 'method not allowed' }); return }
        const payload = JSON.stringify(healthPayload())
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(req.method === 'HEAD' ? undefined : payload)
      },
    }), 'agentLoopSelector.health()')
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path: '/api/hulala/runtimes', handler: async (req, res) => {
        try {
        const requestUrl = new URL(req.url ?? '/api/hulala/runtimes', 'http://127.0.0.1')
        const requestedSessionId = requestUrl.searchParams.get('sessionId')?.trim() || undefined
        if (req.method === 'GET') {
          send(res, 200, await this.describe(requestedSessionId))
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
            sessionId?: unknown
          }
          send(res, 200, await this.select(input))
        } catch (error) {
          send(res, 409, { error: error instanceof Error ? error.message : String(error) })
        }
        } catch (error) {
          send(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'agentLoopSelector.webApi()')

    const clientPath = new URL('./client/runtime-ui.js', import.meta.url)
    ctx.effect(() => ctx.webServer.register({
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
    ctx.effect(() => ctx.webServer.tapIndex(html => html.replace('</body>', `${script}</body>`)), 'agentLoopSelector.webUi()')
  }
}

export default AgentLoopSelector
