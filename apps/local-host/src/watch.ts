import { watch, type FSWatcher } from 'node:fs'
import { resolve } from 'node:path'
import type { Workspace } from '@hulala/workbench-contracts'
import type { EventHub } from './events.ts'

export function resolveWorkspaceWatchPath(workspacePath: string, filename: string): string {
  return resolve(workspacePath, filename || '.')
}

export class WorkspaceWatchService {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly pending = new Map<string, Set<string>>()
  private readonly timers = new Map<string, Timer>()

  constructor(private readonly events: EventHub) {}

  watch(workspace: Workspace): void {
    if (this.watchers.has(workspace.id)) return
    const watcher = watch(workspace.path, { recursive: true }, (_event, filename) => {
      const paths = this.pending.get(workspace.id) ?? new Set<string>()
      paths.add(resolveWorkspaceWatchPath(workspace.path, filename?.toString() || '.'))
      this.pending.set(workspace.id, paths)
      if (this.timers.has(workspace.id)) return
      this.timers.set(workspace.id, setTimeout(() => {
        this.timers.delete(workspace.id)
        const changed = [...(this.pending.get(workspace.id) ?? [])]
        this.pending.delete(workspace.id)
        if (changed.length) this.events.emit({ type: 'filesystem.changed', workspaceId: workspace.id, paths: changed })
      }, 80))
    })
    watcher.on('error', error => console.error('workspace watcher failed', { workspaceId: workspace.id, error }))
    this.watchers.set(workspace.id, watcher)
  }

  close(): void {
    for (const watcher of this.watchers.values()) watcher.close()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.watchers.clear()
    this.timers.clear()
  }
}
