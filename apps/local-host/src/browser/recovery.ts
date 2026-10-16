import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { RecoveryBackupStore } from '../recoveryBackupStore'
import { HttpError, json, parseJson } from '../http'
import { writePrivateJson } from '../config'

const identity = z.object({ workspaceTabId: z.string().uuid(), id: z.string().min(1).max(256) })
const draft = identity.extend({
  version: z.literal(1), title: z.string().max(32768), content: z.string().max(16 * 1024 * 1024),
  editorId: z.string().min(1).max(128), contentVersion: z.number().int().nonnegative(),
  uri: z.string().max(32768).optional(), filePath: z.string().max(32768).optional(),
  fileVersion: z.string().max(4096).nullable().optional(), pane: z.enum(['main', 'right']).optional(),
})
const restore = z.object({ viewId: z.string().uuid(), activeViews: z.array(z.string().uuid()).max(1000) })
const viewSnapshot = z.object({ version: z.literal(1), views: z.array(z.object({ workspaceId: z.string().uuid(), viewId: z.string().uuid(), expiresAt: z.number().int() })).max(5000) })

/** One durable journal per Workspace; browser views never delete each other's drafts. */
export class BrowserRecovery {
  private readonly views = new Map<string, { count: number; generation: number; expiresAt: number }>()
  private readonly stores = new Map<string, RecoveryBackupStore>()
  private readonly operations = new Map<string, Promise<unknown>>()
  private readonly grace = new Map<string, number>()
  private readonly initialized: Promise<void>
  private checkpoints: Promise<void> = Promise.resolve()
  private sealed = false
  constructor(private readonly root: string, private readonly now = Date.now) {
    this.initialized = (async () => {
      try {
        const snapshot = viewSnapshot.parse(JSON.parse(await readFile(join(root, 'active-views.json'), 'utf8')))
        for (const view of snapshot.views) {
          const key = view.workspaceId + ':' + view.viewId
          if (!this.views.has(key) && view.expiresAt > this.now()) this.grace.set(key, Math.min(view.expiresAt, this.now() + 30000))
        }
      } catch { /* Advisory leases must not prevent recovery of durable buffers. */ }
    })()
  }
  checkpointViews(): Promise<void> {
    const write = this.checkpoints.catch(() => undefined).then(async () => {
      await this.initialized
      const live = new Map([...this.grace].filter(([, expires]) => expires > this.now()))
      for (const [key, value] of this.views) if (value.count || value.expiresAt > this.now()) live.set(key, this.now() + 30000)
      await writePrivateJson(join(this.root, 'active-views.json'), { version: 1, views: [...live].map(([key, expiresAt]) => {
        const [workspaceId, viewId] = key.split(':'); return { workspaceId, viewId, expiresAt }
      }) })
    })
    this.checkpoints = write
    return write
  }
  async sealViews(): Promise<void> { this.sealed = true; await this.checkpointViews() }

  registerView(workspaceId: string, viewId: string): void {
    const key = workspaceId + ':' + viewId
    const previous = this.views.get(key)
    this.views.set(key, { count: previous?.count || 0, generation: (previous?.generation || 0) + 1, expiresAt: this.now() + 30000 })
  }

  connectView(workspaceId: string, viewId: string): () => void {
    const key = workspaceId + ':' + viewId
    if (!this.views.has(key)) this.registerView(workspaceId, viewId)
    const entry = this.views.get(key)!
    entry.count++
    this.grace.delete(key)
    if (!this.sealed) void this.checkpointViews().catch(() => undefined)
    const generation = entry.generation
    return () => {
      const latest = this.views.get(key)
      if (!latest) return
      latest.count = Math.max(0, latest.count - 1)
      if (!latest.count && latest.generation === generation) latest.expiresAt = this.now()
      if (!this.sealed) void this.checkpointViews().catch(() => undefined)
    }
  }

  private activeViews(workspaceId: string): string[] {
    const active: string[] = []
    for (const [key, expires] of this.grace) {
      if (expires <= this.now()) { this.grace.delete(key); continue }
      if (key.startsWith(workspaceId + ':')) active.push(key.slice(workspaceId.length + 1))
    }
    for (const [key, value] of this.views) {
      if (!value.count && value.expiresAt <= this.now()) { this.views.delete(key); continue }
      if (key.startsWith(workspaceId + ':')) active.push(key.slice(workspaceId.length + 1))
    }
    return active
  }

  async request(workspaceId: string, action: string, request: Request): Promise<Response> {
    await this.initialized
    if (action === '/views' && request.method === 'GET') {
      const activeViews = this.activeViews(workspaceId), current = new URL(request.url).searchParams.get('viewId')
      await this.operations.get(workspaceId)
      const records = await (this.stores.get(workspaceId) || new RecoveryBackupStore(join(this.root, workspaceId))).load()
      const recoveryWaitMs = Math.max(0, ...records.filter(record => record.workspaceTabId !== current).map(record => (this.grace.get(workspaceId + ':' + record.workspaceTabId) || 0) - this.now()))
      return json({ activeViews, recoveryWaitMs })
    }
    if (action === '/views' && request.method === 'POST') {
      const { viewId } = await parseJson(request, z.object({ viewId: z.string().uuid() }))
      this.registerView(workspaceId, viewId)
      return json({ registered: true })
    }
    let store = this.stores.get(workspaceId)
    if (!store) {
      store = new RecoveryBackupStore(join(this.root, workspaceId))
      this.stores.set(workspaceId, store)
      this.operations.set(workspaceId, store.load())
    }
    const previous = this.operations.get(workspaceId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(async () => {
      if (action === '/drafts' && request.method === 'PUT') {
        const input = await parseJson(request, draft, 20 * 1024 * 1024)
        store.stage(input)
        await store.flush()
        return json({ persisted: true })
      }
      if (action === '/drafts' && request.method === 'DELETE') {
        await store.delete(await parseJson(request, identity))
        return json({ deleted: true })
      }
      if (action === '/drafts/restore' && request.method === 'POST') {
        const { viewId, activeViews } = await parseJson(request, restore)
        const liveViews = new Set([...activeViews, ...this.activeViews(workspaceId)])
        const records = await store.load()
        const recovered = []
        for (const record of records) {
          if (record.workspaceTabId !== viewId && liveViews.has(record.workspaceTabId)) continue
          if (record.workspaceTabId === viewId) { recovered.push(record); continue }
          // Distinct recovered buffers survive even when they refer to the same file.
          const claimed = { ...record, workspaceTabId: viewId, id: crypto.randomUUID() }
          store.stage(claimed)
          await store.flush()
          await store.delete(record)
          recovered.push(claimed)
        }
        return json(recovered)
      }
      throw new HttpError(404, 'route_not_found', 'Draft route not found')
    })
    this.operations.set(workspaceId, current)
    try { return await current } finally { if (this.operations.get(workspaceId) === current) this.operations.delete(workspaceId) }
  }

  async flush(): Promise<void> { await Promise.all(this.operations.values()); await this.checkpoints.catch(() => undefined); await Promise.all([...this.stores.values()].map(store => store.flush())) }
  async count(workspaceIds: string[]): Promise<number> {
    await this.flush()
    let count = 0
    for (const id of workspaceIds) {
      const store = this.stores.get(id) || new RecoveryBackupStore(join(this.root, id))
      count += (await store.load()).length
    }
    return count
  }
}
