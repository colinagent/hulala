import type { WorkspaceWorkers } from './workers'
import type { BrowserRecovery } from './recovery'
import { HttpError } from '../http'

type Background = { pause(): Promise<void>; resume(): void }
export interface LifecycleSummary { workspaces: number; commands: number; conversations: number; cron: number; plugins: number; drafts: number; unknown: number }
export class BrowserLifecycle {
  private writes = 0
  private stopped = false
  private lease?: { id: string; timer: ReturnType<typeof setTimeout> }
  constructor(private workers: WorkspaceWorkers, private recovery: BrowserRecovery, private ids: () => string[], private background: () => Background) {}
  enter(): () => void {
    if (this.lease || this.stopped) throw new HttpError(409, 'service_restarting', 'The local service is preparing to restart. Keep this page open; pending drafts will retry after it reconnects.')
    this.writes++
    return () => { this.writes-- }
  }
  async summary(quiesce = false): Promise<LifecycleSummary> {
    const workers = await this.workers.running()
    const summary: LifecycleSummary = { workspaces: workers.length, commands: 0, conversations: 0, cron: 0, plugins: 0, drafts: await this.recovery.count(this.ids()), unknown: 0 }
    await Promise.all(workers.map(async worker => {
      try {
        const response = await worker.request('/lifecycle', { ...(quiesce ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quiesce: true }) } : {}), signal: AbortSignal.timeout(5000) })
        if (!response.ok) throw new Error('Host lifecycle unavailable')
        const value = await response.json() as Record<string, unknown>
        for (const key of ['commands', 'conversations', 'cron', 'plugins'] as const) {
          if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0) throw new Error('Invalid Host lifecycle state')
          summary[key] += Number(value[key])
        }
      } catch { summary.unknown++ }
    }))
    return summary
  }
  async prepare(force: boolean): Promise<{ lease: string; summary: LifecycleSummary }> {
    if (this.lease || this.stopped) throw new HttpError(409, 'service_restarting', 'Another service transition is already in progress')
    const id = crypto.randomUUID()
    this.lease = { id, timer: setTimeout(() => { void this.cancel(id) }, 60000) }; this.lease.timer.unref()
    try {
      await this.background().pause()
      const deadline = Date.now() + 20000
      while (this.writes && Date.now() < deadline) await Bun.sleep(20)
      if (this.writes) throw new HttpError(409, 'writes_in_progress', 'File transfers or changes are still in progress. Retry after they finish.')
      const summary = await this.summary(true)
      if (this.lease?.id !== id) throw new HttpError(409, 'restart_expired', 'The restart reservation expired. Retry the operation.')
      if (!force && (summary.commands || summary.conversations || summary.cron || summary.plugins || summary.drafts || summary.unknown)) {
        throw new HttpError(409, 'active_work', `Restart would affect ${summary.conversations} Agent turns, ${summary.commands} commands, ${summary.cron} Cron runs, ${summary.plugins} plugins and ${summary.drafts} drafts (${summary.unknown} unavailable Hosts). Save your work, or explicitly repeat with --force.`)
      }
      return { lease: id, summary }
    } catch (error) { await this.cancel(id); throw error }
  }
  async cancel(id: string): Promise<void> {
    if (this.lease?.id !== id || this.stopped) return
    clearTimeout(this.lease.timer)
    await Promise.all((await this.workers.running()).map(worker => worker.request('/lifecycle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quiesce: false }), signal: AbortSignal.timeout(5000) }).catch(() => undefined)))
    if (this.lease?.id !== id || this.stopped) return
    this.lease = undefined; this.background().resume()
  }
  stop(): void { this.stopped = true; if (this.lease) clearTimeout(this.lease.timer); this.lease = undefined }
}
