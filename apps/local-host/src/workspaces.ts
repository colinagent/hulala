import { mkdir, rmdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { HulalaPaths, Workspace } from '@hulala/workbench-contracts'
import { ensureDefaultWorkspace } from './defaultWorkspace.ts'
import { HttpError } from './http.ts'

interface NativeWorkspace {
  readonly id: string
  readonly path: string
  readonly title: string
}

export interface NativeWorkspaceRegistry {
  list(): readonly NativeWorkspace[]
  get(id: string): NativeWorkspace | undefined
  resolveByPath(path: string): Promise<NativeWorkspace | undefined>
  create(path: string, title?: string): Promise<NativeWorkspace>
}

export class WorkspaceRegistry {
  private selectedId?: string
  constructor(readonly paths: HulalaPaths, private readonly native: NativeWorkspaceRegistry, private readonly initializeDefault = true) {}

  async initialize(): Promise<void> {
    await mkdir(this.paths.workspace, { recursive: true, mode: 0o700 })
    if (this.initializeDefault) await ensureDefaultWorkspace(this.paths.workspace)
    if (await this.native.resolveByPath(this.paths.workspace) === undefined) {
      await this.native.create(this.paths.workspace)
    }
    if (!this.initializeDefault) {
      this.selectedId = (await this.native.resolveByPath(this.paths.workspace))?.id
      if (!this.selectedId) throw new Error('Selected Workspace could not be registered')
    }
  }

  list(): Workspace[] {
    return this.native.list().filter(workspace => !this.selectedId || workspace.id === this.selectedId).map(workspace => this.fromNative(workspace))
  }

  get(id: string): Workspace {
    if (this.selectedId && id !== this.selectedId) throw new HttpError(403, 'workspace_scope', 'This Host serves only the selected Workspace')
    const workspace = this.native.get(id)
    if (workspace === undefined) throw new HttpError(404, 'workspace_not_found', `workspace not found: ${id}`)
    return this.fromNative(workspace)
  }

  async add(path: string): Promise<Workspace> {
    if (this.selectedId) throw new HttpError(403, 'workspace_scope', 'Open another Workspace through the browser registry')
    return this.fromNative(await this.native.create(path))
  }

  async createManaged(rawName: string): Promise<Workspace> {
    if (this.selectedId) throw new HttpError(403, 'workspace_scope', 'Create another Workspace through the browser registry')
    const name = normalizeManagedWorkspaceName(rawName)
    const workspaceRoot = resolve(this.paths.workspaceRoot)
    const target = resolve(workspaceRoot, name)
    if (dirname(target) !== workspaceRoot) {
      throw new HttpError(400, 'workspace_name_invalid', 'workspace name must be a single directory name')
    }

    await mkdir(workspaceRoot, { recursive: true, mode: 0o700 })
    try {
      await mkdir(target, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new HttpError(409, 'workspace_exists', `workspace already exists: ${name}`)
      }
      throw new HttpError(
        500,
        'workspace_create_failed',
        error instanceof Error ? error.message : 'failed to create workspace',
      )
    }

    try {
      return await this.add(target)
    } catch (error) {
      await rmdir(target).catch(() => undefined)
      throw error
    }
  }

  private fromNative(workspace: NativeWorkspace): Workspace {
    return { id: workspace.id, path: workspace.path, name: workspace.title }
  }
}

export function normalizeManagedWorkspaceName(rawName: string): string {
  const name = rawName.trim()
  if (!name || name === '.' || name === '..') {
    throw new HttpError(400, 'workspace_name_invalid', 'workspace name is required')
  }
  if (/[\\/]/u.test(name) || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new HttpError(400, 'workspace_name_invalid', 'workspace name contains invalid characters')
  }
  return name
}
