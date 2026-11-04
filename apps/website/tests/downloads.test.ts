import { describe, test, expect } from 'bun:test'
import { byteRange, createGateway, type GatewayEnv } from '../downloads/gateway'
import { DownloadQuota, reserve, type Counter, type QuotaState } from '../downloads/quota'
import { projectedPeak, R2_CAPACITY_BYTES } from '../../../scripts/release/r2Capacity'

const item = { key: 'hulala/web/1.0.0/hulala-1.0.0-linux-x64.tar.gz', size: 10, sha256: 'a'.repeat(64), fallback: 'https://github.com/colinagent/hulala/releases/download/web-v1.0.0/hulala-1.0.0-linux-x64.tar.gz' }
const worker = createGateway([item, { ...item, key: 'hulala/web/latest/install.sh', static: true }])
function fixture(status = 204) {
  let reads = 0, quotas = 0
  const env: GatewayEnv = {
    ASSETS: { fetch: async () => new Response('static installer') },
    QUOTA: { idFromName: x => x, get: () => ({ fetch: async () => { quotas++; return new Response(null, { status }) } }) },
    RELEASES: {
      head: async () => { reads++; return { size: 10, httpEtag: '"test"', writeHttpMetadata: () => {} } },
      get: async (_key, options) => {
        reads++
        const range = options?.range
        return { size: 10, httpEtag: '"test"', body: new Response(range ? '0123456789'.slice(range.offset, range.offset + range.length) : '0123456789').body!, writeHttpMetadata: (h: Headers) => h.set('content-type', 'application/octet-stream') }
      },
    },
  }
  return { env, counts: () => ({ reads, quotas }) }
}
const request = (headers?: HeadersInit, method = 'GET') => new Request('https://downloads.hulala.ai/' + item.key, { method, headers })

describe('download gateway prevents bypass and fails closed', () => {
  test('quota denial redirects without reading R2, preserving resume method', async () => {
    const f = fixture(429), response = await worker.fetch(request({ range: 'bytes=3-' }), f.env)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(item.fallback)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(f.counts().reads).toBe(0)
  })
  test('counter failure never reads R2', async () => {
    const f = fixture()
    f.env.QUOTA.get = () => ({ fetch: async () => { throw new Error('unavailable') } })
    expect((await worker.fetch(request(), f.env)).status).toBe(307)
    expect(f.counts().reads).toBe(0)
  })
  test('unknown keys, unsupported writes and invalid ranges do not consume quota', async () => {
    const f = fixture()
    expect((await worker.fetch(new Request('https://downloads.hulala.ai/secret'), f.env)).status).toBe(404)
    expect((await worker.fetch(request(undefined, 'PUT'), f.env)).status).toBe(405)
    expect((await worker.fetch(request({ range: 'bytes=0-1,4-5' }), f.env)).status).toBe(416)
    expect(f.counts()).toEqual({ reads: 0, quotas: 0 })
  })
  test('metadata never reads R2 or the counter', async () => {
    const f = fixture(429)
    expect(await (await worker.fetch(new Request('https://downloads.hulala.ai/hulala/web/latest/install.sh?bust=1'), f.env)).text()).toBe('static installer')
    expect(f.counts()).toEqual({ reads: 0, quotas: 0 })
  })
  test('GET and HEAD each use at most one R2 operation', async () => {
    const f = fixture()
    const response = await worker.fetch(request({ range: 'bytes=3-6' }), f.env)
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 3-6/10')
    expect(response.headers.get('content-length')).toBe('4')
    expect(await response.text()).toBe('3456')
    const head = await worker.fetch(request(undefined, 'HEAD'), f.env)
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect(f.counts()).toEqual({ reads: 2, quotas: 2 })
  })
  test('stale If-Range returns the full file; matching If-None-Match returns 304', async () => {
    const f = fixture()
    const response = await worker.fetch(request({ range: 'bytes=3-', 'if-range': '"old"' }), f.env)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('0123456789')
    expect((await worker.fetch(request({ 'if-none-match': `W/"sha256-${item.sha256}"` }), f.env)).status).toBe(304)
  })
  test('missing legacy mirrors return 503 rather than a different installer', async () => {
    const f = fixture(429)
    const legacy = createGateway([{ ...item, fallback: undefined }])
    expect((await legacy.fetch(request(), f.env)).status).toBe(503)
    expect(f.counts().reads).toBe(0)
  })
})

test('ranges are bounded, including suffix/open-ended ranges', () => {
  expect(byteRange('bytes=-3', 10)).toEqual({ offset: 7, length: 3 })
  expect(byteRange('bytes=8-100', 10)).toEqual({ offset: 8, length: 2 })
  expect(byteRange('bytes=10-', 10)).toBeNull()
  expect(byteRange('bytes=-0', 10)).toBeNull()
  expect(byteRange('bytes=9007199254740993-', 10)).toBeNull()
})

test('day/month resets preserve the other budget and reject clock rollback', () => {
  const old: Counter = { day: '2026-10-17', month: '2026-10', daily: 2, monthly: 3 }
  expect(reserve(old, new Date('2026-10-17T12:00:00Z'), 2, 5)).toBeNull()
  expect(reserve(old, new Date('2026-10-18T00:00:00Z'), 2, 5)).toEqual({ day: '2026-10-18', month: '2026-10', daily: 1, monthly: 4 })
  expect(reserve({ ...old, monthly: 5 }, new Date('2026-10-18T00:00:00Z'), 2, 5)).toBeNull()
  expect(reserve(old, new Date('2026-11-01T00:00:00Z'), 2, 5)?.monthly).toBe(1)
  expect(reserve(old, new Date('2026-10-16T00:00:00Z'))).toBeNull()
})

test('quota persists across object recreation and serializes concurrent reservations', async () => {
  let value: Counter | undefined = { day: new Date().toISOString().slice(0, 10), month: new Date().toISOString().slice(0, 7), daily: 19_997, monthly: 499_997 }
  let tail: Promise<unknown> = Promise.resolve()
  const state: QuotaState = { storage: { transaction: callback => {
    const result = tail.then(() => callback({ get: async <T>() => value as T, put: async (_key, next) => { value = next as Counter } }))
    tail = result.catch(() => {})
    return result
  } } }
  const responses = await Promise.all(Array.from({ length: 20 }, () => new DownloadQuota(state).fetch(new Request('https://quota.internal/reserve', { method: 'POST' }))))
  expect(responses.filter(x => x.status === 204)).toHaveLength(3)
  expect(value?.daily).toBe(20_000)
  expect(value?.monthly).toBe(500_000)
})

test('storage gate counts existing objects, rejects oversized and duplicate plans', () => {
  expect(projectedPeak([{ key: 'a', size: 7_000_000_000 }], [{ key: 'b', size: 1_000_000_000 }])).toBe(8_000_000_000)
  expect(() => projectedPeak([{ key: 'a', size: R2_CAPACITY_BYTES }], [{ key: 'b', size: 1 }])).toThrow('exceeds')
  expect(() => projectedPeak([], [{ key: 'a', size: 1 }, { key: 'a', size: 1 }])).toThrow('Invalid')
  expect(() => projectedPeak([{ key: 'a', size: R2_CAPACITY_BYTES }], [{ key: 'a', size: 0 }, { key: 'b', size: 1 }])).toThrow('exceeds')
})
