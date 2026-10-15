import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureHulalaPaths } from '../src/config'
import { ServerDatabase } from '../src/database'
import { EventHub } from '../src/events'
import { MessengerService } from '../src/messenger'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

test('persists Messenger state in the injected Hulala data root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-services-test-'))
  roots.push(root)
  const database = new ServerDatabase(await ensureHulalaPaths(root, join(root, 'managed-workspaces')))
  try {
    // Windows protects files with inherited ACLs, not POSIX permission bits.
    if (process.platform !== 'win32') expect((await stat(database.path)).mode & 0o077).toBe(0)
    const messenger = new MessengerService(database, new EventHub())
    const created = messenger.create({ workspaceId: 'workspace', kind: 'cron', title: 'Finished', body: 'Done' })
    expect(messenger.list()).toHaveLength(1)
    expect(messenger.update(created.id, 'read').readAt).not.toBeNull()
    expect(messenger.update(created.id, 'archive').archivedAt).not.toBeNull()
    expect(messenger.list()).toHaveLength(0)
    expect(messenger.list({ includeArchived: true })).toHaveLength(1)
  } finally { database.close() }
})

test('two views and a response retry send one Messenger reply and preserve the user message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-message-reply-test-')); roots.push(root)
  const database = new ServerDatabase(await ensureHulalaPaths(root, join(root, 'workspaces')))
  try {
    const events = new EventHub(), messenger = new MessengerService(database, events)
    const original = messenger.create({ workspaceId: 'workspace', threadId: 'session', kind: 'cron', title: 'Task finished', body: 'Done' })
    let finish!: () => void, sent = 0
    const delivery = new Promise<void>(resolve => { finish = resolve })
    const deliver = async () => { sent++; await delivery }
    const requestId = crypto.randomUUID()
    const first = messenger.reply(original.id, 'Thanks', requestId, deliver)
    const second = messenger.reply(original.id, 'Thanks', crypto.randomUUID(), deliver)
    await expect(messenger.reply(original.id, 'Different reply', crypto.randomUUID(), deliver)).rejects.toMatchObject({ status: 409 })
    finish()
    const result = await first
    expect(await second).toEqual(result)
    expect(result.record).toMatchObject({ kind: 'user-reply', body: 'Thanks' })
    expect(result.resolved.readAt).not.toBeNull()
    const reloaded = new MessengerService(database, events)
    expect(await reloaded.reply(original.id, 'Thanks', requestId, deliver)).toEqual(result)
    expect(sent).toBe(1)
    expect(messenger.list()).toHaveLength(2)
    let changes = 0
    const off = events.subscribe(event => { if (event.type === 'messenger.changed') changes++ })
    messenger.update(original.id, 'archive'); messenger.update(original.id, 'archive')
    expect(changes).toBe(1)
    off()
  } finally { database.close() }
})

test('prunes only bounded or expired product history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-retention-test-'))
  roots.push(root)
  const database = new ServerDatabase(await ensureHulalaPaths(root, join(root, 'managed-workspaces')))
  const old = new Date('2020-01-01T00:00:00.000Z').toISOString()
  database.db.query(`
    INSERT INTO cron_jobs (id, name, workspace_id, schedule, prompt, enabled, next_run_at, created_at, updated_at)
    VALUES ('cron', 'Cron', 'workspace', '* * * * *', 'run', 1, NULL, ?, ?)
  `).run(old, old)
  for (let index = 0; index < 5; index += 1) {
    database.db.query('INSERT INTO cron_runs (id, cron_id, state, started_at) VALUES (?, ?, ?, ?)')
      .run(`run-${index}`, 'cron', 'accepted', new Date(Date.UTC(2026, 7, 27, 0, 0, index)).toISOString())
  }
  database.db.query(`
    INSERT INTO messages (id, workspace_id, kind, title, body, archived_at, created_at)
    VALUES ('archived-old', 'workspace', 'notice', 'Old', 'Old', ?, ?)
  `).run(old, old)
  database.db.query(`
    INSERT INTO messages (id, workspace_id, kind, title, body, created_at)
    VALUES ('unread-old', 'workspace', 'notice', 'Unread', 'Unread', ?)
  `).run(old)

  database.prune({
    cronRunDays: 365,
    cronRunMaxPerJob: 2,
    archivedMessageDays: 30,
    archiveRunMaxPerWorkspace: 2,
  }, new Date('2026-08-27T00:00:10.000Z'))

  expect(database.db.query('SELECT id FROM cron_runs ORDER BY started_at').all()).toHaveLength(2)
  expect(database.db.query('SELECT id FROM messages ORDER BY id').all()).toEqual([{ id: 'unread-old' }])
  database.close()
})
