import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Dispose, InstalledPlugin, PluginBackend, PluginBackendContext, PluginEvent, PluginManifest } from '@hulala/plugin-sdk'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { entrySchema, packageFile, pluginIdSchema, pluginManifestSchema, validatePackage } from './manifest.ts'

export interface PluginServices {
  ai: PluginBackendContext['ai']
  secrets(id: string): PluginBackendContext['secrets']
}
interface PreviousPlugin { manifest: PluginManifest; revision: string; enabled: boolean }
interface SavedPlugin extends PreviousPlugin { previous?: PreviousPlugin }
interface LivePlugin { fiber: Fiber; abort: AbortController; handlers: Map<string, (input: unknown) => Promise<unknown>> }
const previousSchema = z.object({ manifest: pluginManifestSchema, revision: z.string().uuid(), enabled: z.boolean() })
const savedSchema = z.array(previousSchema.extend({ previous: previousSchema.optional() }).refine(item => !item.previous || item.previous.manifest.id === item.manifest.id)).max(100).refine(items => new Set(items.map(item => item.manifest.id)).size === items.length)
const methodSchema = z.string().regex(/^[a-z][a-zA-Z0-9.-]{0,79}$/)
export class LocalPluginManager {
  private saved = new Map<string, SavedPlugin>()
  private live = new Map<string, LivePlugin>()
  private errors = new Map<string, string>()
  private history: PluginEvent[] = []
  private seq = 0
  private tail: Promise<unknown> = Promise.resolve()
  private stopped = false
  private readonly secretValues = new Map<string, Set<string>>()
  constructor(readonly root: string, private ctx: Context, private services: PluginServices, private readonly workspaceId?: string) {
    if (workspaceId) z.string().uuid().parse(workspaceId)
  }
  private directory(area: 'config' | 'server' | 'runtime') { return join(this.root, area, ...(this.workspaceId ? ['workspaces', this.workspaceId] : []), 'plugins') }
  private get registryPath() { return join(this.directory('config'), 'installed.json') }
  private packageDir(item: SavedPlugin) { return join(this.directory('runtime'), item.manifest.id, item.revision) }
  private secrets(id: string): PluginBackendContext['secrets'] {
    const source = this.services.secrets(this.workspaceId ? this.workspaceId + ':' + id : id)
    const values = this.secretValues.get(id) || new Set<string>(); this.secretValues.set(id, values)
    return {
      resolve: async name => { const value = await source.resolve(name); if (value) values.add(value); return value },
      describe: name => source.describe(name),
      set: async (name, value) => { values.add(value); await source.set(name, value) },
      unset: name => source.unset(name),
    }
  }
  private containsSecret(id: string, value: unknown): boolean {
    const values = this.secretValues.get(id)
    if (!values?.size) return false
    if (typeof value === 'string') return [...values].some(secret => value.includes(secret))
    if (Array.isArray(value)) return value.some(item => this.containsSecret(id, item))
    return !!value && typeof value === 'object' && Object.entries(value).some(([key, child]) => this.containsSecret(id, key) || this.containsSecret(id, child))
  }
  private publicValue(id: string, value: unknown): unknown {
    if (value === undefined) return null
    const encoded = JSON.stringify(value)
    if (Buffer.byteLength(encoded) > 1048576) throw new Error('Plugin response exceeds 1 MiB; use a file for larger data')
    const result: unknown = JSON.parse(encoded)
    if (this.containsSecret(id, result)) throw new Error('Plugin output contains a configured secret')
    return result
  }
  publicError(id: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return this.containsSecret(id, message) ? 'Plugin operation produced sensitive output' : message.slice(0, 2000)
  }
  private async atomic(path: string, value: unknown) {
    const temporary = path + '.' + crypto.randomUUID() + '.tmp'
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
    await rename(temporary, path)
  }
  async initialize(): Promise<void> {
    await mkdir(this.directory('config'), { recursive: true, mode: 0o700 })
    let items: SavedPlugin[] = []
    try { items = savedSchema.parse(JSON.parse(await readFile(this.registryPath, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    for (const item of items) {
      this.saved.set(item.manifest.id, item)
      if (item.enabled) await this.start(item).catch(error => this.errors.set(item.manifest.id, this.publicError(item.manifest.id, error)))
    }
  }
  list(): InstalledPlugin[] {
    return [...this.saved.values()].map(item => ({
      manifest: item.manifest, revision: item.revision, enabled: item.enabled, state: this.live.has(item.manifest.id) ? 'active' : this.errors.has(item.manifest.id) ? 'failed' : 'disabled',
      ...(this.errors.has(item.manifest.id) ? { error: this.errors.get(item.manifest.id) } : {}),
    }))
  }
  events(after: number) { return { cursor: this.seq, events: this.history.filter(event => event.seq > after) } }
  private emit(pluginId: string, topic: string, data: unknown) {
    try { if (this.containsSecret(pluginId, topic)) throw new Error('Sensitive topic'); data = this.publicValue(pluginId, data) }
    catch { topic = 'host.sensitiveOutputBlocked'; data = { message: 'Plugin output was withheld' } }
    this.history.push({ seq: ++this.seq, pluginId, topic, data })
    if (this.history.length > 500) this.history.shift()
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => { if (this.stopped) throw new Error('plugin host stopped'); return fn() })
    this.tail = next.catch(() => undefined)
    return next
  }
  private save() { return this.atomic(this.registryPath, [...this.saved.values()]) }
  install(source: string): Promise<InstalledPlugin> {
    return this.exclusive(async () => {
      const files = await validatePackage(source)
      if (!files.includes('manifest.json')) throw new Error('manifest.json is required')
      const manifest = pluginManifestSchema.parse(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')))
      if (!this.saved.has(manifest.id) && this.saved.size >= 100) throw new Error('plugin limit reached')
      const previous = this.saved.get(manifest.id)
      const item: SavedPlugin = { manifest, revision: crypto.randomUUID(), enabled: previous?.enabled ?? false,
        ...(previous ? { previous: { manifest: previous.manifest, revision: previous.revision, enabled: previous.enabled } } : {}) }
      const destination = this.packageDir(item)
      await mkdir(destination, { recursive: true, mode: 0o700 })
      try {
        for (const file of files) {
          const target = join(destination, file)
          await mkdir(join(target, '..'), { recursive: true })
          await cp(await packageFile(source, file), target, { dereference: false })
        }
        await validatePackage(destination)
        for (const path of [manifest.backend, manifest.ui, ...(manifest.styles ?? [])]) await packageFile(destination, path)
        const uiSource = await readFile(await packageFile(destination, manifest.ui), 'utf8')
        if (!new Bun.Transpiler({ loader: 'js' }).scan(uiSource).exports.includes('activate')) throw new Error('UI must export activate')
        // Validate backend export without activating any jobs. Installed code is trusted.
        const module = await import(pathToFileURL(await packageFile(destination, manifest.backend)).href) as PluginBackend
        if (typeof module.activate !== 'function') throw new Error('backend must export activate')
        await this.stopPlugin(manifest.id)
        this.saved.set(manifest.id, item)
        if (item.enabled) await this.start(item)
        await this.save()
        this.emit(manifest.id, 'host.changed', null)
        return this.list().find(p => p.manifest.id === manifest.id)!
      } catch (error) {
        await this.stopPlugin(manifest.id)
        if (previous) {
          this.saved.set(manifest.id, previous)
          if (previous.enabled) await this.start(previous).catch(rollback => this.errors.set(manifest.id, this.publicError(manifest.id, rollback)))
        } else this.saved.delete(manifest.id)
        await rm(destination, { recursive: true, force: true })
        throw new Error(this.publicError(manifest.id, error))
      }
    })
  }
  enable(id: string, enabled: boolean): Promise<void> {
    return this.exclusive(async () => {
      const item = this.require(id)
      if (enabled) await this.start(item)
      else await this.stopPlugin(id)
      item.enabled = enabled
      await this.save()
      this.emit(id, 'host.changed', null)
    })
  }
  uninstall(id: string): Promise<void> {
    return this.exclusive(async () => {
      this.require(id)
      await this.stopPlugin(id)
      this.saved.delete(id)
      await this.save()
      await rm(join(this.directory('runtime'), id), { recursive: true, force: true })
      this.emit(id, 'host.changed', null)
    })
  }
  rollback(id: string, revision: string): Promise<{ restored: boolean }> {
    return this.exclusive(async () => {
      const item = this.require(id)
      if (item.revision !== revision) return { restored: false }
      await this.stopPlugin(id)
      if (item.previous) {
        const previous = item.previous
        this.saved.set(id, previous)
        if (previous.enabled) await this.start(previous)
        this.errors.set(id, '新版插件界面加载失败，已恢复上一版本。')
        await this.save()
        this.emit(id, 'host.changed', null)
        return { restored: true }
      }
      item.enabled = false
      this.errors.set(id, '插件界面加载失败，已停用。')
      await this.save()
      this.emit(id, 'host.changed', null)
      return { restored: false }
    })
  }
  private require(id: string) {
    pluginIdSchema.parse(id)
    const item = this.saved.get(id)
    if (!item) throw new Error('plugin is not installed')
    return item
  }
  async asset(id: string, revision: string, file: string): Promise<string> {
    const item = this.require(id)
    if (!item.enabled || !this.live.has(id) || revision !== item.revision) throw new Error('plugin is not active')
    entrySchema.parse(file)
    if (!(file === item.manifest.ui || item.manifest.styles?.includes(file)) && !/\.(svg|png|jpe?g|webp|woff2?)$/.test(file)) throw new Error('asset is not exposed')
    return packageFile(this.packageDir(item), file)
  }
  async rpc(id: string, method: string, input: unknown) {
    this.require(id); methodSchema.parse(method)
    const handler = this.live.get(id)?.handlers.get(method)
    if (!handler) throw new Error('plugin method is unavailable')
    try { return this.publicValue(id, await handler(input)) }
    catch (error) { throw new Error(this.publicError(id, error)) }
  }
  async setSecret(id: string, name: string, value?: string) {
    this.require(id); methodSchema.parse(name)
    if (value === undefined) await this.secrets(id).unset(name)
    else {
      if (!value || value.length > 8192) throw new Error('invalid credential value')
      await this.secrets(id).set(name, value)
    }
  }
  private async start(item: SavedPlugin) {
    const id = item.manifest.id
    if (this.live.has(id)) return
    this.errors.delete(id)
    const abort = new AbortController()
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>()
    const disposers: Dispose[] = []
    const jobs = new Set<Promise<unknown>>()
    const dataDir = join(this.directory('server'), id)
    const settingsPath = join(this.directory('config'), id + '.json')
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    const context: PluginBackendContext = {
      id, dataDir, signal: abort.signal,
      ai: { currentModel: () => this.services.ai.currentModel(), analyze: input => this.services.ai.analyze({ ...input, signal: AbortSignal.any([abort.signal, ...(input.signal ? [input.signal] : [])]) }) },
      secrets: this.secrets(id),
      settings: {
        read: async () => { try { return JSON.parse(await readFile(settingsPath, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error } },
        write: async value => { abort.signal.throwIfAborted(); await this.atomic(settingsPath, this.publicValue(id, value)) },
      },
      rpc: { register: (method, input, output, handler) => {
        methodSchema.parse(method)
        if (handlers.has(method)) throw new Error('duplicate plugin method')
        handlers.set(method, async value => {
          abort.signal.throwIfAborted()
          const validated = input.parse(value)
          const job = Promise.resolve().then(() => handler(validated)).then(result => output.parse(result))
          jobs.add(job)
          try { return await job } finally { jobs.delete(job) }
        })
        return () => { handlers.delete(method) }
      } },
      events: { emit: (topic, schema, value) => { methodSchema.parse(topic); if (!abort.signal.aborted) this.emit(id, topic, schema.parse(value)) } },
      schedule: (interval, task, immediate = false) => {
        if (!Number.isFinite(interval) || interval < 1000) throw new Error('invalid task interval')
        let busy = false
        const run = () => {
          if (busy || abort.signal.aborted) return
          busy = true
          const job = Promise.resolve().then(task).catch(() => {
            if (!abort.signal.aborted) this.emit(id, 'host.taskError', { message: 'Background task failed' })
          }).finally(() => { busy = false; jobs.delete(job) })
          jobs.add(job)
        }
        const timer = setInterval(run, interval)
        const dispose = () => clearInterval(timer)
        disposers.push(dispose)
        if (immediate) run()
        return dispose
      },
      onDispose: dispose => { disposers.push(dispose) },
      log: (level, message) => { this.emit(id, 'host.log', { level, message: this.publicError(id, message) }) },
    }
    let fiber: Fiber | undefined
    try {
      const module = await import(pathToFileURL(await packageFile(this.packageDir(item), item.manifest.backend)).href) as PluginBackend
      fiber = this.ctx.plugin({ name: 'local-plugin-' + id, apply: async () => {
        const cleanup = await module.activate(context)
        if (cleanup) disposers.push(cleanup)
      } })
      await fiber
      this.live.set(id, { fiber, abort, handlers })
      // Abort and drain work before plugin-owned databases close.
      fiber.ctx.effect(() => async () => {
        abort.abort()
        await Promise.allSettled([...jobs])
        for (const dispose of disposers.reverse()) await dispose()
        handlers.clear()
      }, 'local-plugin: dispose resources')
    } catch (error) {
      abort.abort()
      await Promise.allSettled([...jobs])
      for (const dispose of disposers.reverse()) await Promise.resolve().then(dispose).catch(() => undefined)
      await fiber?.dispose()
      this.errors.set(id, 'Plugin activation failed: ' + this.publicError(id, error))
      throw error
    }
  }
  private async stopPlugin(id: string) {
    const live = this.live.get(id)
    this.live.delete(id)
    if (live) { live.abort.abort(); await live.fiber.dispose() }
    this.errors.delete(id)
  }
  async stop() {
    await this.tail
    this.stopped = true
    for (const id of [...this.live.keys()]) await this.stopPlugin(id)
  }
}
