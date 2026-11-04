import { test, expect } from 'bun:test'
import { Miniflare } from 'miniflare'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

test('real SQLite quota prevents concurrent overshoot and survives restart', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'hulala-download-quota-'))
  let mf: Miniflare | undefined
  try {
    const built = await Bun.build({ entrypoints: [resolve(import.meta.dirname, 'fixtures/downloads-worker.ts')], target: 'browser', format: 'esm' })
    if (!built.success) throw new Error(String(built.logs))
    const script = await built.outputs[0]!.text()
    const options = {
      modules: true, script, compatibilityDate: '2026-05-22',
      durableObjects: { QUOTA: { className: 'DownloadQuota', useSQLite: true } },
      durableObjectsPersist: resolve(directory, 'do'),
      r2Buckets: ['RELEASES'], r2Persist: resolve(directory, 'r2'),
    }
    mf = new Miniflare(options)
    const ns = await mf.getDurableObjectNamespace('QUOTA') as unknown as { idFromName(name: string): unknown; get(id: unknown): { fetch(url: string, options: RequestInit): Promise<Response> } }
    await ns.get(ns.idFromName('hulala-downloads-v1')).fetch('https://test/seed', { method: 'POST' })
    const bucket = await mf.getR2Bucket('RELEASES') as unknown as { put(key: string, value: string): Promise<unknown> }
    await bucket.put('hulala/web/1.0.0/test', '0123456789')
    const responses = await Promise.all(Array.from({ length: 20 }, () => mf!.dispatchFetch('https://test/hulala/web/1.0.0/test', { headers: { range: 'bytes=3-6' }, redirect: 'manual' })))
    expect(responses.filter(x => x.status === 206)).toHaveLength(3)
    expect(responses.filter(x => x.status === 307)).toHaveLength(17)
    for (const response of responses) if (response.status === 206) expect(await response.text()).toBe('3456')
    await mf.dispose()
    mf = new Miniflare(options)
    const exhausted = await mf.dispatchFetch('https://test/hulala/web/1.0.0/test', { redirect: 'manual' })
    expect(exhausted.status).toBe(307)
  } finally {
    await mf?.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
