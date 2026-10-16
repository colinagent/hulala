import { Database } from 'bun:sqlite'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import type { HulalaPaths } from '@hulala/workbench-contracts'

export class ServerDatabase {
  readonly db: Database
  readonly path: string

  constructor(paths: HulalaPaths) {
    this.path = join(paths.server, 'desktop.sqlite')
    this.db = new Database(this.path, { create: true, strict: true })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
    this.secureFiles()
  }

  close(): void {
    this.db.close()
    this.secureFiles()
  }

  prune(retention: NonNullable<import('./config.ts').ServerConfig['retention']>, now = new Date()): void {
    const cronCutoff = new Date(now.getTime() - retention.cronRunDays * 86_400_000).toISOString()
    const messageCutoff = new Date(now.getTime() - retention.archivedMessageDays * 86_400_000).toISOString()
    this.db.transaction(() => {
      this.db.query("DELETE FROM cron_runs WHERE started_at < ? AND state NOT IN ('queued', 'running')").run(cronCutoff)
      const cronIds = this.db.query('SELECT id FROM cron_jobs').all() as Array<{ id: string }>
      for (const { id } of cronIds) {
        this.db.query(`
          DELETE FROM cron_runs WHERE cron_id = ? AND state NOT IN ('queued', 'running') AND id NOT IN (
            SELECT id FROM cron_runs WHERE cron_id = ? ORDER BY started_at DESC, id DESC LIMIT ?
          )
        `).run(id, id, retention.cronRunMaxPerJob)
      }
      this.db.query('DELETE FROM messages WHERE archived_at IS NOT NULL AND archived_at < ?').run(messageCutoff)
      const workspaceIds = this.db.query('SELECT DISTINCT workspace_id AS id FROM archive_runs').all() as Array<{ id: string }>
      for (const { id } of workspaceIds) {
        this.db.query(`
          DELETE FROM archive_runs WHERE workspace_id = ? AND id NOT IN (
            SELECT id FROM archive_runs WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
          )
        `).run(id, id, retention.archiveRunMaxPerWorkspace)
      }
    })()
  }

  private migrate(): void {
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cron_jobs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          schedule TEXT NOT NULL,
          prompt TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          next_run_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cron_runs (
          id TEXT PRIMARY KEY,
          cron_id TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
          state TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          error TEXT,
          session_id TEXT
        );
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          thread_id TEXT,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          read_at TEXT,
          archived_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS archive_runs (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          removed_count INTEGER NOT NULL,
          reclaimed_bytes INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS message_replies (
          message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
          request_id TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          state TEXT NOT NULL,
          reply_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL
        );
      `)
      try {
        this.db.exec('ALTER TABLE cron_runs ADD COLUMN session_id TEXT')
      } catch {
        // Column already exists.
      }
      for (const [table, columns] of Object.entries({
        cron_jobs: { config_json: "TEXT NOT NULL DEFAULT '{}'", revision: 'INTEGER NOT NULL DEFAULT 1' },
        cron_runs: { trigger: "TEXT NOT NULL DEFAULT 'manual'", scheduled_at: 'TEXT', request_id: 'TEXT' },
      })) {
        const names = new Set((this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name))
        for (const [column, declaration] of Object.entries(columns)) if (!names.has(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
      }
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS cron_run_request ON cron_runs(cron_id, request_id) WHERE request_id IS NOT NULL')
    })()
  }

  private secureFiles(): void {
    for (const path of [this.path, `${this.path}-wal`, `${this.path}-shm`]) {
      try { chmodSync(path, 0o600) } catch { /* Missing transient WAL files and Windows ACLs are expected. */ }
    }
  }
}
