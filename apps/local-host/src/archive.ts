import { lstat, readdir, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { ServerDatabase } from './database.ts'
import type { Workspace } from '@hulala/workbench-contracts'
import type { WorkspaceFiles } from './files'
import { HttpError } from './http'

export interface ArchiveCandidate {
  path: string
  size: number
  modifiedAt: string
}

async function directoryStats(path: string, budget = { remaining: 100000 }): Promise<{ size: number; modified: number }> {
  if (--budget.remaining < 0) throw new HttpError(413, 'archive_too_large', 'Archive scan exceeded its entry limit')
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink()) return { size: 0, modified: 0 }
  if (!metadata.isDirectory()) return { size: metadata.size, modified: metadata.mtimeMs }
  let size = 0, modified = metadata.mtimeMs
  for (const name of await readdir(path)) { const child = await directoryStats(join(path, name), budget); size += child.size; modified = Math.max(modified, child.modified) }
  return { size, modified }
}

export class ArchiveService {
  constructor(private readonly database: ServerDatabase, private readonly files: WorkspaceFiles) {}

  async candidates(workspace: Workspace, olderThanDays = 30): Promise<ArchiveCandidate[]> {
    workspace = { ...workspace, path: await realpath(workspace.path) }
    const threshold = Date.now() - Math.max(1, olderThanDays) * 86_400_000
    const candidates: ArchiveCandidate[] = []
    for (const archiveRoot of [join(workspace.path, '.agent', 'archive'), join(workspace.path, '.hulala', 'archive')]) {
      const exists = await lstat(archiveRoot).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
      if (!exists || exists.isSymbolicLink()) continue
      const boundedRoot = await this.files.resolve(workspace, archiveRoot)
      for (const name of await readdir(boundedRoot)) {
        const path = join(boundedRoot, name)
        const metadata = await lstat(path)
        if (metadata.isSymbolicLink()) continue
        const contents = await directoryStats(path)
        if (contents.modified >= threshold) continue
        candidates.push({ path: relative(workspace.path, path), size: contents.size, modifiedAt: new Date(contents.modified).toISOString() })
      }
    }
    return candidates
  }

  async run(workspace: Workspace, olderThanDays: number, execute: boolean): Promise<{ candidates: ArchiveCandidate[]; reclaimedBytes: number }> {
    workspace = { ...workspace, path: await realpath(workspace.path) }
    const candidates = await this.candidates(workspace, olderThanDays)
    const reclaimedBytes = candidates.reduce((total, candidate) => total + candidate.size, 0)
    if (execute) {
      for (const candidate of candidates) {
        const path = await this.files.resolve(workspace, candidate.path)
        if (path !== join(workspace.path, candidate.path)) throw new HttpError(409, 'archive_changed', 'Archive entry changed during cleanup')
        const current = await directoryStats(path)
        if (current.size !== candidate.size || new Date(current.modified).toISOString() !== candidate.modifiedAt) throw new HttpError(409, 'archive_changed', 'Archive contents changed during cleanup. Review the candidates again.')
        await this.files.remove(workspace, candidate.path)
      }
    }
    this.database.db.query(`
      INSERT INTO archive_runs (id, workspace_id, mode, removed_count, reclaimed_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), workspace.id, execute ? 'execute' : 'preview', execute ? candidates.length : 0, execute ? reclaimedBytes : 0, new Date().toISOString())
    return { candidates, reclaimedBytes }
  }
}
