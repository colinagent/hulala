import { test, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { latestOnlyCatalog, prunePlan, releaseFiles, retainedKeys, validateReleaseMetadata } from '../../../scripts/release/r2Retention'
import { pruneR2 } from '../../../scripts/release/pruneR2'
import { createGateway, type GatewayEnv } from '../downloads/gateway'
import { createHash } from 'node:crypto'

const policy = { web: '0.1.6', desktop: '0.1.4' }
const sha256 = createHash('sha256').update('x').digest('hex')
const current = [...retainedKeys(policy)].map(key => ({ key, size: 1, sha256 }))
const old = { key: 'hulala/web/0.1.5/hulala-0.1.5-linux-x64.tar.gz', size: 1, sha256, fallback: 'https://github.com/colinagent/hulala/releases/download/web-v0.1.5/hulala-0.1.5-linux-x64.tar.gz' }
const duplicate = { ...current[0]!, key: current[0]!.key.replace('/0.1.6/', '/latest/') }

test('retention keeps exactly one complete release per product and aliases latest', () => {
  const next = latestOnlyCatalog([...current, old, duplicate], policy)
  // Eight canonical files per retained Web (terminal client) release — four
  // archives, the installer, the release index, the checksums and the shared npm
  // lock — nine per Desktop release, plus one latest alias each.
  expect(next.filter(x => !x.retired && !x.objectKey)).toHaveLength(17)
  expect(next.find(x => x.key === duplicate.key)?.objectKey).toBe(current[0]!.key)
  expect(next.find(x => x.key === old.key)?.retired).toBe(true)
  expect(latestOnlyCatalog(next, policy)).toEqual(next)
  expect(prunePlan([...current, old, duplicate], next, policy).map(x => x.key)).toEqual([old.key, duplicate.key])
  expect(prunePlan(current, next, policy)).toEqual([])
})

test('missing latest files, malformed versions and unknown concurrent uploads block cleanup', () => {
  expect(() => latestOnlyCatalog(current.slice(1), policy)).toThrow('Incomplete')
  expect(() => releaseFiles('web', '../latest')).toThrow()
  const next = latestOnlyCatalog([...current, old], policy)
  expect(() => prunePlan([...current, { key: 'unpublished', size: 1 }], next, policy)).toThrow('Uncatalogued')
  expect(() => prunePlan(current.slice(1), next, policy)).toThrow('missing')
  expect(() => prunePlan(current.map((x, index) => index ? x : { ...x, size: 2 }), next, policy)).toThrow('changed')
})

test('stale channel metadata cannot promote or clean up a new release', () => {
  const platforms = Object.fromEntries(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].map(target => [target, { url: `https://downloads.hulala.ai/hulala/web/0.1.6/hulala-0.1.6-${target}.tar.gz`, sha256 }]))
  const metadata = { channels: { stable: '0.1.6' }, releases: [{ version: '0.1.6', platforms }] }
  expect(() => validateReleaseMetadata('web', '0.1.6', metadata, current)).not.toThrow()
  expect(() => validateReleaseMetadata('web', '0.1.7', metadata, current)).toThrow('promote')
  expect(() => validateReleaseMetadata('web', '0.1.6', metadata, current.map(x => ({ ...x, sha256: 'bad' })))).toThrow('integrity')
})

test('latest binary alias reads the canonical key; retired URLs never touch R2 or quota', async () => {
  const next = latestOnlyCatalog([...current, old], policy)
  let key = '', reservations = 0
  const env = {
    ASSETS: { fetch: async () => new Response('static') },
    QUOTA: { idFromName: (x: string) => x, get: () => ({ fetch: async () => { reservations++; return new Response(null, { status: 204 }) } }) },
    RELEASES: { get: async (value: string) => { key = value; return { size: 1, httpEtag: '"x"', body: new Response('x').body!, writeHttpMetadata: () => {} } }, head: async () => null },
  } satisfies GatewayEnv
  const gateway = createGateway(next)
  expect(await (await gateway.fetch(new Request('https://downloads.hulala.ai/' + duplicate.key), env)).text()).toBe('x')
  expect(key).toBe(current[0]!.key)
  const retired = await gateway.fetch(new Request('https://downloads.hulala.ai/' + old.key), env)
  expect(retired.status).toBe(307)
  expect(retired.headers.get('location')).toBe(old.fallback)
  expect(reservations).toBe(1)
})

for (const failure of ['deployment mismatch', 'download unavailable', 'checksum mismatch'] as const) {
  test(`no deletion when ${failure}`, async () => {
    const evidence = await mkdtemp(join(tmpdir(), 'hulala-retention-'))
    const originalFetch = globalThis.fetch
    const catalog = latestOnlyCatalog([...current, old], policy)
    let deleted = 0
    const fake = {
      list: async () => ({ contents: [...current, old].map(x => ({ ...x, eTag: '"x"' })), isTruncated: false }),
      file: () => ({ stream: () => new Response(failure === 'checksum mismatch' ? 'wrong' : 'x').body! }),
      delete: async () => { deleted++ },
    } as unknown as Bun.S3Client
    globalThis.fetch = (async (url: string | URL | Request) => String(url).includes('_release-state.json')
      ? Response.json({ catalogSha256: failure === 'deployment mismatch' ? 'wrong' : createHash('sha256').update(JSON.stringify(catalog)).digest('hex'), retention: policy })
      : new Response(null, { status: 503 })) as typeof fetch
    try {
      await expect(pruneR2(fake, catalog, policy, true, evidence)).rejects.toThrow()
      expect(deleted).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
      await rm(evidence, { recursive: true, force: true })
    }
  })
}

test('successful cleanup accepts compressed metadata without a length header and only deletes history', async () => {
  const evidence = await mkdtemp(join(tmpdir(), 'hulala-retention-success-'))
  const originalFetch = globalThis.fetch
  const catalog = latestOnlyCatalog([...current.map(x => ({ ...x, static: true })), old, duplicate], policy)
  let objects = [...current, old, duplicate].map(x => ({ ...x, eTag: '"x"' }))
  const deleted: string[] = []
  const fake = {
    list: async () => ({ contents: objects, isTruncated: false }),
    file: () => ({ stream: () => new Response('x').body! }),
    stat: async () => ({ size: 1, etag: '"x"' }),
    delete: async (key: string) => { deleted.push(key); objects = objects.filter(x => x.key !== key) },
  } as unknown as Bun.S3Client
  globalThis.fetch = (async (url: string | URL | Request) => String(url).includes('_release-state.json')
    ? Response.json({ catalogSha256: createHash('sha256').update(JSON.stringify(catalog)).digest('hex'), retention: policy })
    : new Response('x')) as typeof fetch
  try {
    await pruneR2(fake, catalog, policy, true, evidence)
    expect(deleted).toEqual([old.key, duplicate.key])
    expect(objects.map(x => x.key)).toEqual(current.map(x => x.key))
  } finally {
    globalThis.fetch = originalFetch
    await rm(evidence, { recursive: true, force: true })
  }
})
