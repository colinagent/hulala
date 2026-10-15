import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWorkspaceRegistry } from '../src/browser/registry'
import { WorkspaceWorkers } from '../src/browser/workers'
import { hasEnabledCron, restoreScheduledWorkspaces, superviseScheduledWorkspaces } from '../src/browser/background'

test('isolates runtime selection and state while sharing a native credential path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-browser-workers-'))
  const previousPi = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = join(root, 'pi')
  const workers = new WorkspaceWorkers({ repositoryRoot: join(import.meta.dir, '../../..'), hulalaRoot: join(root, 'state'), workspaceRoot: join(root, 'workspaces'), version: 'test' })
  try {
    const registry = new BrowserWorkspaceRegistry(join(root, 'registry.json'), join(root, 'workspaces'))
    await registry.load()
    const [first, second] = await Promise.all([registry.create('project A'), registry.create('项目 B')])
    const [a, b, repeated] = await Promise.all([workers.get(first), workers.get(second), workers.get(first)])
    expect(a).toBe(repeated)
    expect(a.process.pid).not.toBe(b.process.pid)
    const state = async (worker: typeof a) => (await (await worker.request('/harness/runtime-state')).json()) as { current: string }
    expect((await state(b)).current).toBe('pi')
    const scheduled = await b.request('/cron', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Background startup QA', workspaceId: b.workspace.id, schedule: { every: '1d' }, prompt: 'Synthetic future task; removed during test cleanup', enabled: true }) })
    expect(scheduled.status).toBe(201)
    expect(await hasEnabledCron(join(root, 'state'), second.id)).toBeTrue()
    const switched = await a.request('/harness/runtime-selection', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runtime: 'deepseek' }) })
    expect(switched.ok).toBe(true)
    expect((await state(a)).current).toBe('deepseek')
    await new Promise(resolve => setTimeout(resolve, 200))
    expect((await state(b)).current).toBe('pi')
    expect(await readdir(first.path)).toEqual([])
    expect(await readdir(second.path)).toEqual([])
    const write = (content: string, expectedVersion: string | null) => a.request('/files/text', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: a.workspace.id, path: 'race.md', content, expectedVersion }),
    })
    const created = await write('original', null)
    expect(created.status).toBe(200)
    const { version } = await created.json() as { version: string }
    const read = await a.request('/files/text?workspaceId=' + a.workspace.id + '&path=race.md')
    expect(await read.json()).toMatchObject({ content: 'original', version })
    const raced = await Promise.all([write('first edit', version), write('second edit', version)])
    expect(raced.map(response => response.status).sort()).toEqual([200, 409])
    expect(await raced.find(response => response.status === 409)!.json()).toMatchObject({ code: 'file_conflict' })
    expect((await write('unexpected overwrite', null)).status).toBe(409)
    const winner = await raced.find(response => response.status === 200)!.json() as { version: string }
    const renamed = await a.request('/files/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: a.workspace.id, from: 'race.md', to: 'renamed.md' }) })
    expect(renamed.status).toBe(200)
    const moved = await renamed.json() as { versionBefore: string; versionAfter: string }
    expect(moved.versionBefore).toBe(winner.version)
    expect(typeof moved.versionAfter).toBe('string')
    expect((await a.request('/files/text', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: a.workspace.id, path: 'renamed.md', content: 'after rename', expectedVersion: moved.versionAfter }) })).status).toBe(200)
    await mkdir(join(first.path, 'nested'))
    await writeFile(join(first.path, 'nested', 'search.txt'), 'Alpha-42\nalpha-7\n')
    const search = await a.request('/files/search?' + new URLSearchParams({ workspaceId: a.workspace.id, path: 'nested', query: 'Alpha-\\d+', regex: 'true', matchCase: 'true' }))
    expect(search.status).toBe(200)
    expect(await search.json()).toMatchObject({ items: [{ path: join(first.path, 'nested', 'search.txt'), line: 1, text: 'Alpha-42' }] })
    await a.stop()
    expect((await state(b)).current).toBe('pi')
    await workers.stop()
    const restarted = new WorkspaceWorkers(workers.options)
    const supervisor = superviseScheduledWorkspaces(restarted, () => registry.list(), () => {}, 100)
    try {
      await supervisor.ready
      expect(await restoreScheduledWorkspaces(restarted, registry.list())).toEqual([])
      const restored = await restarted.get(second)
      expect(restored.process.pid).not.toBe(b.process.pid)
      const response = await restored.request('/cron')
      expect((await response.json() as { items: unknown[] }).items).toHaveLength(1)
      await restored.stop()
      // The supervisor starts a replacement without a page requesting it.
      let replacementStarted = false
      const start = restarted.get.bind(restarted)
      restarted.get = async workspace => { const worker = await start(workspace); if (workspace.id === second.id && worker.process.pid !== restored.process.pid) replacementStarted = true; return worker }
      const deadline = Date.now() + 10000
      while (!replacementStarted) { if (Date.now() > deadline) throw new Error('Background worker was not recovered'); await Bun.sleep(25) }
    } finally { await supervisor.stop(); await restarted.stop() }
  } finally {
    await workers.stop()
    if (previousPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousPi
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
