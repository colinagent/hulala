import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureHulalaPaths } from '../src/config'
import { ServerDatabase } from '../src/database'
import { EventHub } from '../src/events'
import { MessengerService } from '../src/messenger'
import { CronService } from '../src/cron'
import { nextCronDate, normalizeSchedule } from '../src/cronSchedule'

const cleanups: Array<() => Promise<unknown> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hulala-cron-test-'))
  const paths = await ensureHulalaPaths(root, join(root, 'workspaces'))
  const database = new ServerDatabase(paths), events = new EventHub(), messenger = new MessengerService(database, events)
  let now = Date.parse('2026-01-01T00:00:00Z'), calls = 0
  const selections: unknown[] = []
  const workspace = { id: 'workspace', name: 'Test', path: paths.workspace }
  const harness = { createTaskSession: async (input: { modelKey?: string }) => { if (input.modelKey) { const [provider, model] = input.modelKey.split(':'); selections.push({ provider, model }) }; return { sessionId: crypto.randomUUID() } },
    prompt: async (sessionId: string) => { calls++; events.emit({ type: 'conversation.turnEnded', sessionId, outcome: 'completed' }) } }
  const registry = { get: (id: string) => { if (id !== workspace.id) throw new Error('Wrong Workspace'); return workspace } }
  const service = new CronService(database, events, harness as never, messenger, registry as never, () => now)
  service.start()
  cleanups.push(() => rm(root, { recursive: true, force: true }), () => database.close(), () => service.stop())
  return { service, database, events, messenger, workspace, harness, registry, selections, clock: () => now, advance: (ms: number) => { now += ms }, calls: () => calls }
}
test('interval, one-time and timezone cron rules use explicit times and coalesce missed intervals', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  expect(nextCronDate(normalizeSchedule({ every: '5m' }), now + 26 * 60000, now)?.toISOString()).toBe('2026-01-01T00:30:00.000Z')
  expect(nextCronDate(normalizeSchedule({ cron: '0 9 * * *', timeZone: 'Asia/Shanghai' }), now)?.toISOString()).toBe('2026-01-01T01:00:00.000Z')
  expect(nextCronDate(normalizeSchedule({ time: '2026-01-01T08:30:00+08:00' }), now)?.toISOString()).toBe('2026-01-01T00:30:00.000Z')
  expect(() => normalizeSchedule({ every: '0s' })).toThrow('interval')
  expect(() => normalizeSchedule({ cron: '* * * * *', timeZone: 'Not/AZone' })).toThrow('time zone')
  expect(() => normalizeSchedule({ time: '2026-01-01T09:00' })).toThrow('UTC offset')
})
test('two views or schedulers cannot dispatch the same due occurrence twice, and immediate completion is recorded', async () => {
  const f = await fixture()
  const input = { name: 'Background QA', workspaceId: f.workspace.id, schedule: { every: '5m' }, prompt: 'Synthetic prompt', modelKey: 'fixture:model', enabled: true }
  const job = await f.service.create(input)
  f.advance(26 * 60000)
  const second = new CronService(f.database, f.events, f.harness as never, f.messenger, f.registry as never, f.clock)
  await Promise.all([f.service.tick(), second.tick()])
  expect(f.calls()).toBe(1)
  expect(f.service.history(job.id)[0]).toMatchObject({ status: 'completed', trigger: 'scheduled' })
  expect(f.service.list()[0]?.nextRunAt).toBe('2026-01-01T00:30:00.000Z')
  expect(f.messenger.list()).toHaveLength(1)
  expect(f.selections).toEqual([{ provider: 'fixture', model: 'model' }])
  const requestId = crypto.randomUUID()
  const [one, duplicate] = await Promise.all([f.service.run(job.id, requestId), f.service.run(job.id, requestId)])
  expect(one).toEqual(duplicate)
  expect(await f.service.run(job.id, requestId)).toEqual(one)
  expect(f.calls()).toBe(2)
})
test('a one-time task dispatches once; stale or invalid updates leave the saved task unchanged', async () => {
  const f = await fixture()
  const input = { name: 'Once', workspaceId: f.workspace.id, schedule: { time: '2026-01-01T00:01:00Z' }, prompt: 'Synthetic', enabled: true }
  const job = await f.service.create(input)
  await expect(f.service.update(job.id, { ...input, name: '', expectedRevision: 1 })).rejects.toThrow()
  expect(f.service.list()[0]?.name).toBe('Once')
  const paused = await f.service.update(job.id, { ...input, enabled: false, expectedRevision: 1 })
  expect(paused.revision).toBe(2)
  await expect(f.service.update(job.id, { ...input, expectedRevision: 1 })).rejects.toMatchObject({ status: 409 })
  await f.service.update(job.id, { ...input, expectedRevision: 2 })
  f.advance(120000)
  await f.service.tick(); await f.service.tick()
  expect(f.calls()).toBe(1)
  expect(f.service.list()[0]?.enabled).toBeFalse()
  expect(f.service.list()[0]?.nextRunAt).toBeNull()
})
