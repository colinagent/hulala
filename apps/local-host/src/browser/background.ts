import { Database } from 'bun:sqlite'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWorkspace } from '@hulala/workbench-contracts/browser'
import type { WorkspaceWorkers } from './workers'

export async function hasEnabledCron(root: string, workspaceId: string): Promise<boolean> {
  const filename = join(root, 'server', 'workspaces', workspaceId, 'desktop.sqlite')
  if (!await stat(filename).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })) return false
  const database = new Database(filename, { readonly: true })
  try { return !!database.query('SELECT 1 FROM cron_jobs WHERE enabled = 1 LIMIT 1').get() } finally { database.close() }
}

/** Browser views are not the lifetime owner of scheduled work. */
export async function restoreScheduledWorkspaces(workers: WorkspaceWorkers, workspaces: BrowserWorkspace[]): Promise<string[]> {
  const failures: string[] = []
  const queue = workspaces.filter(workspace => workspace.kind === 'local')
  await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length) {
      const workspace = queue.shift()!
      try { if (await hasEnabledCron(workers.options.hulalaRoot, workspace.id)) await workers.get(workspace) }
      catch { failures.push(workspace.id) }
    }
  }))
  return failures
}

/** Recover scheduled workers even when there are no browser pages to reconnect. */
export function superviseScheduledWorkspaces(workers: WorkspaceWorkers, list: () => BrowserWorkspace[], report: (failed: string[]) => void, intervalMs = 30000) {
  let pending: Promise<string[]> | undefined
  let stopped = false
  let paused = false
  const refresh = () => {
    if (pending) return pending
    if (stopped || paused) return Promise.resolve([])
    pending = restoreScheduledWorkspaces(workers, list()).then(failed => { report(failed); return failed })
      .finally(() => { pending = undefined })
    return pending
  }
  const ready = refresh()
  const timer = setInterval(() => { void refresh() }, intervalMs)
  timer.unref()
  return { ready, async pause() { paused = true; await pending }, resume() { paused = false; void refresh() }, async stop() { stopped = true; clearInterval(timer); await pending } }
}
