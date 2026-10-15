import { stat } from 'node:fs/promises'
import { cronInputSchema, cronScheduleSchema, type CronInput, type CronSchedule } from '@hulala/workbench-contracts'
import type { ServerDatabase } from './database'
import type { EventHub } from './events'
import type { HarnessApiAdapter } from './runtime'
import type { MessengerService } from './messenger'
import type { WorkspaceRegistry } from './workspaces'
import { HttpError } from './http'
import { resolveWorkspacePath } from './files'
import { nextCronDate, normalizeSchedule } from './cronSchedule'

export interface CronJobRecord {
  id: string; name: string; workspaceId: string; workspacePath: string; schedule: CronSchedule; prompt: string; enabled: boolean
  description?: string; cwd: string; modelKey?: string; revision: number
  nextRunAt: string | null; createdAt: string; updatedAt: string
  lastRun?: { state: string; startedAt: string; finishedAt?: string; error?: string; sessionId?: string }
}
interface CronJobRow {
  id: string; name: string; workspace_id: string; schedule: string; prompt: string; enabled: number
  next_run_at: string | null; created_at: string; updated_at: string; config_json: string; revision: number
}
type RunResult = { runId: string; sessionId?: string }

/** Product background jobs; native Schedule remains a live-session reminder capability. */
export class CronService {
  private timer?: ReturnType<typeof setInterval>
  private ticking = false
  private stopped = false
  private quiescing = false
  async quiesce(value: boolean): Promise<void> {
    this.quiescing = value
    if (value) { while (this.ticking) await Bun.sleep(10); await Promise.allSettled(this.dispatching.values()) }
  }
  private unsubscribe?: () => void
  private readonly dispatching = new Map<string, Promise<RunResult>>()
  constructor(private readonly database: ServerDatabase, private readonly events: EventHub, private readonly harness: HarnessApiAdapter,
    private readonly messenger: MessengerService, private readonly workspaces: WorkspaceRegistry, private readonly clock = Date.now) {}

  start(): void {
    if (this.timer || this.stopped) return
    this.database.db.query("UPDATE cron_runs SET state = 'interrupted', finished_at = ?, error = 'The Host stopped before this run finished.' WHERE state IN ('queued', 'running')").run(this.now())
    this.unsubscribe = this.events.subscribe(event => {
      if (event.type !== 'conversation.turnEnded') return
      const rows = this.database.db.query("SELECT id, cron_id FROM cron_runs WHERE session_id = ? AND state IN ('queued', 'running')").all(event.sessionId) as Array<{ id: string; cron_id: string }>
      for (const run of rows) {
        this.database.db.query('UPDATE cron_runs SET state = ?, finished_at = ? WHERE id = ?').run(event.outcome, this.now(), run.id)
        const job = this.get(run.cron_id)
        this.messenger.create({ workspaceId: job.workspaceId, threadId: event.sessionId, kind: event.outcome === 'failed' ? 'cron-error' : 'cron', title: job.name, body: 'Scheduled Agent turn ' + event.outcome + '.' })
        this.changed(job.id)
      }
    })
    this.timer = setInterval(() => { void this.tick().catch(() => undefined) }, 1000)
    this.timer.unref()
    void this.tick().catch(() => undefined)
  }
  async stop(): Promise<void> { this.stopped = true; clearInterval(this.timer); this.unsubscribe?.(); await Promise.allSettled(this.dispatching.values()) }
  private now(): string { return new Date(this.clock()).toISOString() }
  private changed(id: string): void { this.events.emit({ type: 'cron.changed', cronId: id }) }
  private record(row: CronJobRow): CronJobRecord {
    const config = JSON.parse(row.config_json) as { description?: string; cwd?: string; modelKey?: string }
    const workspace = this.workspaces.get(row.workspace_id)
    const last = this.database.db.query('SELECT state, started_at, finished_at, error, session_id FROM cron_runs WHERE cron_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(row.id) as Record<string, string | null> | null
    return { id: row.id, name: row.name, workspaceId: row.workspace_id, workspacePath: workspace.path,
      schedule: cronScheduleSchema.parse(JSON.parse(row.schedule)), prompt: row.prompt, enabled: row.enabled === 1,
      ...config, cwd: config.cwd || workspace.path, revision: row.revision, nextRunAt: row.next_run_at, createdAt: row.created_at, updatedAt: row.updated_at,
      ...(last ? { lastRun: { state: last.state!, startedAt: last.started_at!, ...(last.finished_at ? { finishedAt: last.finished_at } : {}), ...(last.error ? { error: last.error } : {}), ...(last.session_id ? { sessionId: last.session_id } : {}) } } : {}) }
  }
  private get(id: string): CronJobRecord {
    const row = this.database.db.query('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJobRow | null
    if (!row) throw new HttpError(404, 'cron_not_found', 'Scheduled task not found')
    return this.record(row)
  }
  list(): CronJobRecord[] { return (this.database.db.query('SELECT * FROM cron_jobs ORDER BY name, id').all() as CronJobRow[]).map(row => this.record(row)) }
  private async normalize(input: CronInput) {
    const value = cronInputSchema.parse(input)
    const workspace = this.workspaces.get(value.workspaceId)
    const cwd = await resolveWorkspacePath(workspace, value.cwd || '.')
    if (!(await stat(cwd)).isDirectory()) throw new HttpError(400, 'cron_cwd_invalid', 'Choose a working directory')
    const schedule = normalizeSchedule(value.schedule)
    if (value.modelKey && !/^[^:]+:.+/.test(value.modelKey)) throw new HttpError(400, 'cron_model_invalid', 'Choose a provider and model')
    return { ...value, schedule, enabled: value.enabled !== false, config: { cwd, description: value.description, modelKey: value.modelKey } }
  }
  async create(input: CronInput): Promise<CronJobRecord> {
    const value = await this.normalize(input), now = this.now()
    const next = nextCronDate(value.schedule, this.clock())
    if (value.enabled && !next) throw new HttpError(400, 'cron_time_past', 'Choose a future execution time')
    const id = value.requestId || crypto.randomUUID()
    const existing = this.database.db.query('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJobRow | null
    if (existing) {
      if (existing.name !== value.name || existing.workspace_id !== value.workspaceId || existing.prompt !== value.prompt || existing.schedule !== JSON.stringify(value.schedule) || existing.config_json !== JSON.stringify(value.config)) throw new HttpError(409, 'cron_identity_conflict', 'This creation request already belongs to a different task')
      return this.get(id)
    }
    this.database.db.query('INSERT INTO cron_jobs (id, name, workspace_id, schedule, prompt, enabled, next_run_at, created_at, updated_at, config_json, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)').run(
      id, value.name, value.workspaceId, JSON.stringify(value.schedule), value.prompt, value.enabled ? 1 : 0, value.enabled ? next?.toISOString() || null : null, now, now, JSON.stringify(value.config))
    this.changed(id)
    return this.get(id)
  }
  async update(id: string, input: CronInput): Promise<CronJobRecord> {
    const old = this.get(id), value = await this.normalize(input)
    const next = value.enabled ? nextCronDate(value.schedule, this.clock(), Date.parse(old.createdAt)) : null
    if (value.enabled && !next) throw new HttpError(400, 'cron_time_past', 'Choose a future execution time')
    if (input.expectedRevision === undefined) throw new HttpError(409, 'cron_conflict', 'Reload this task before saving')
    const result = this.database.db.query('UPDATE cron_jobs SET name = ?, workspace_id = ?, schedule = ?, prompt = ?, enabled = ?, next_run_at = ?, updated_at = ?, config_json = ?, revision = revision + 1 WHERE id = ? AND revision = ?').run(
      value.name, value.workspaceId, JSON.stringify(value.schedule), value.prompt, value.enabled ? 1 : 0, next?.toISOString() || null, this.now(), JSON.stringify(value.config), id, input.expectedRevision)
    if (!result.changes) throw new HttpError(409, 'cron_conflict', 'This task was changed in another view. Reload it before saving.')
    this.changed(id)
    return this.get(id)
  }
  remove(id: string): void {
    if (this.database.db.query("SELECT id FROM cron_runs WHERE cron_id = ? AND state IN ('queued', 'running') LIMIT 1").get(id)) throw new HttpError(409, 'cron_running', 'Stop the active Agent turn before deleting this task')
    if (!this.database.db.query('DELETE FROM cron_jobs WHERE id = ?').run(id).changes) throw new HttpError(404, 'cron_not_found', 'Scheduled task not found')
    this.changed(id)
  }
  history(id: string, limit = 99) {
    this.get(id)
    return (this.database.db.query('SELECT * FROM cron_runs WHERE cron_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?').all(id, Math.max(1, Math.min(500, limit))) as Array<Record<string, string | null>>).map(row => ({
      runID: row.id!, taskID: row.cron_id!, trigger: row.trigger!, startedAtMs: Date.parse(row.started_at!), status: row.state!,
      ...(row.scheduled_at ? { scheduledAtMs: Date.parse(row.scheduled_at) } : {}),
      ...(row.finished_at ? { finishedAtMs: Date.parse(row.finished_at), durationMs: Date.parse(row.finished_at) - Date.parse(row.started_at!) } : {}),
      ...(row.error ? { error: row.error } : {}), ...(row.session_id ? { threadID: row.session_id } : {}),
    }))
  }
  async run(id: string, requestId: string = crypto.randomUUID(), trigger = 'manual', scheduledAt?: string): Promise<RunResult> {
    if (this.stopped) throw new HttpError(503, 'host_stopping', 'The Host is stopping')
    const pending = this.dispatching.get(id)
    if (pending) return pending
    const work = this.dispatch(id, requestId, trigger, scheduledAt)
    this.dispatching.set(id, work)
    try { return await work } finally { this.dispatching.delete(id) }
  }
  private async dispatch(id: string, requestId: string, trigger: string, scheduledAt?: string): Promise<RunResult> {
    const job = this.get(id)
    const active = this.database.db.query("SELECT id, session_id FROM cron_runs WHERE cron_id = ? AND (request_id = ? OR state IN ('queued', 'running')) ORDER BY started_at DESC LIMIT 1").get(id, requestId) as { id: string; session_id: string | null } | null
    if (active) return { runId: active.id, ...(active.session_id ? { sessionId: active.session_id } : {}) }
    const runId = crypto.randomUUID()
    this.database.db.query("INSERT INTO cron_runs (id, cron_id, state, started_at, trigger, scheduled_at, request_id) VALUES (?, ?, 'queued', ?, ?, ?, ?)").run(runId, id, this.now(), trigger, scheduledAt || null, requestId)
    this.changed(id)
    try {
      // Bind the session before prompting so fast completion events cannot race registration.
      const session = await this.harness.createTaskSession({ workspaceId: job.workspaceId, cwd: await resolveWorkspacePath(this.workspaces.get(job.workspaceId), job.cwd), modelKey: job.modelKey })
      this.database.db.query("UPDATE cron_runs SET session_id = ?, state = 'running' WHERE id = ?").run(session.sessionId, runId)
      await this.harness.prompt(session.sessionId, { requestId: runId, mode: 'queue', content: [{ type: 'text', text: job.prompt }], clientTimeZone: job.schedule.timeZone })
      return { runId, sessionId: session.sessionId }
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 2000) : 'Task could not be started'
      this.database.db.query("UPDATE cron_runs SET state = 'failed', finished_at = ?, error = ? WHERE id = ?").run(this.now(), message, runId)
      this.messenger.create({ workspaceId: job.workspaceId, kind: 'cron-error', title: job.name, body: message })
      throw error
    } finally { this.changed(id) }
  }
  async tick(): Promise<void> {
    if (this.ticking || this.stopped || this.quiescing) return
    this.ticking = true
    try {
      const due = this.database.db.query('SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 50').all(this.now()) as CronJobRow[]
      for (const row of due) {
        if (this.stopped || this.quiescing) break
        const job = this.record(row), next = nextCronDate(job.schedule, this.clock(), Date.parse(job.createdAt))
        const claimed = this.database.db.query('UPDATE cron_jobs SET next_run_at = ?, enabled = ?, updated_at = ? WHERE id = ? AND next_run_at = ? AND enabled = 1').run(next?.toISOString() || null, next ? 1 : 0, this.now(), job.id, job.nextRunAt)
        if (!claimed.changes) continue
        this.changed(job.id)
        await this.run(job.id, crypto.randomUUID(), 'scheduled', job.nextRunAt || undefined).catch(() => undefined)
      }
    } finally { this.ticking = false }
  }
}
