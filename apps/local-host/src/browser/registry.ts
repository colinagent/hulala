import { mkdir, readFile, realpath, stat, rmdir } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { browserWorkspaceListSchema, type BrowserWorkspace } from '@hulala/workbench-contracts/browser'
import { writePrivateJson } from '../config'
import { normalizeManagedWorkspaceName } from '../workspaces'
import { HttpError } from '../http'

/** Stable Workspace identities, independent of browser views and worker lifetimes. */
export class BrowserWorkspaceRegistry {
  private items: BrowserWorkspace[] = []
  private writes: Promise<unknown> = Promise.resolve()
  constructor(readonly filename: string, readonly workspaceRoot: string) {}
  async load(): Promise<void> {
    try { this.items = browserWorkspaceListSchema.parse(JSON.parse(await readFile(this.filename, 'utf8'))).items }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  list(): BrowserWorkspace[] { return this.items.map(item => ({ ...item })) }
  get(id: string): BrowserWorkspace {
    const found = this.items.find(item => item.id === id)
    if (!found) throw new HttpError(404, 'workspace_not_found', 'Workspace not found')
    return { ...found }
  }
  async open(path: string): Promise<BrowserWorkspace> {
    if (!isAbsolute(path) || path.includes('\0')) throw new Error('An absolute directory is required')
    const canonical = await realpath(path)
    if (!(await stat(canonical)).isDirectory()) throw new Error('Workspace must be a directory')
    const run = this.writes.then(async () => {
      const found = this.items.find(item => item.kind === 'local' && item.path === canonical)
      if (found) return { ...found }
      const item: BrowserWorkspace = { id: crypto.randomUUID(), name: basename(canonical) || canonical, path: canonical, kind: 'local', createdAt: new Date().toISOString() }
      const next = [...this.items, item]
      await writePrivateJson(this.filename, { version: 1, items: next })
      this.items = next
      return { ...item }
    })
    this.writes = run.catch(() => undefined)
    return run
  }
  async create(name: string): Promise<BrowserWorkspace> {
    const path = join(this.workspaceRoot, normalizeManagedWorkspaceName(name))
    await mkdir(this.workspaceRoot, { recursive: true, mode: 0o700 })
    await mkdir(path, { mode: 0o700 })
    try { return await this.open(path) }
    catch (error) { await rmdir(path).catch(() => undefined); throw error }
  }
  openRemote(hostId: string, hostLabel: string, path: string): Promise<BrowserWorkspace> {
    const run = this.writes.then(async () => {
      const existing = this.items.find(item => item.kind === 'remote' && item.hostId === hostId && item.path === path)
      if (existing) return { ...existing }
      const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
      const item: BrowserWorkspace = { id: crypto.randomUUID(), name, path, kind: 'remote', hostId, hostLabel, createdAt: new Date().toISOString() }
      const next = [...this.items, item]
      await writePrivateJson(this.filename, { version: 1, items: next })
      this.items = next
      return { ...item }
    })
    this.writes = run.catch(() => undefined)
    return run
  }
}
