/**
 * Retention verification shared by the download-site tests and the private
 * release tooling. Bucket credentials and the CLI entry stay outside this
 * repository; callers pass an S3 client in.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Download } from '../../apps/website/downloads/gateway'
import { latestOnlyCatalog, prunePlan, retainedKeys, type Retention } from './r2Retention'
import { createHash } from 'node:crypto'

export async function bucketInventory(client: Bun.S3Client) {
  const entries: { key: string; size: number; etag: string }[] = []
  let cursor: string | undefined
  for (let page = 0; page < 10; page++) {
    const result = await client.list({ maxKeys: 1000, ...(cursor ? { continuationToken: cursor } : {}) })
    entries.push(...(result.contents ?? []).map(x => {
      if (!x.eTag) throw new Error('Missing object identity; refusing cleanup')
      return { key: x.key, size: Number(x.size), etag: x.eTag }
    }))
    if (!result.isTruncated) return entries
    if (!result.nextContinuationToken || result.nextContinuationToken === cursor) throw new Error('Invalid inventory pagination')
    cursor = result.nextContinuationToken
  }
  throw new Error('Too many objects; refusing partial inventory')
}

export async function pruneR2(client: Bun.S3Client, catalog: Download[], policy: Retention, apply: boolean, evidenceRoot = resolve(import.meta.dirname, '../../work/r2-retention')) {
  if (JSON.stringify(latestOnlyCatalog(catalog, policy)) !== JSON.stringify(catalog)) throw new Error('Catalog is not normalized for latest-only retention')
  const before = await bucketInventory(client)
  const obsolete = prunePlan(before, catalog, policy)
  const evidence = resolve(evidenceRoot, new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8))
  await mkdir(evidence, { recursive: true })
  await writeFile(resolve(evidence, 'plan.json'), JSON.stringify({ policy, before, obsolete }, null, 2))
  console.log(`Keep ${before.length - obsolete.length} current objects; remove ${obsolete.length} obsolete/duplicate objects (${(obsolete.reduce((n, x) => n + x.size, 0) / 1e9).toFixed(3)} GB).`)
  if (!apply) return
  const hash = createHash('sha256').update(JSON.stringify(catalog)).digest('hex')
  async function assertDeployed() {
    const response = await fetch('https://downloads.hulala.ai/_release-state.json?verify=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error('Latest-only gateway is not deployed; no deletion allowed')
    const state = await response.json() as { catalogSha256: string; retention: Retention }
    if (state.catalogSha256 !== hash || state.retention.web !== policy.web || state.retention.desktop !== policy.desktop) throw new Error('Live release changed or does not match cleanup plan; no deletion allowed')
  }
  await assertDeployed()
  // Verify retained bytes, not only HEAD metadata, before the first deletion.
  for (const key of retainedKeys(policy)) {
    const expected = catalog.find(x => x.key === key)!
    const digest = createHash('sha256')
    const reader = client.file(key).stream().getReader()
    try {
      while (true) { const chunk = await reader.read(); if (chunk.done) break; digest.update(chunk.value) }
    } finally { reader.releaseLock() }
    if (digest.digest('hex') !== expected.sha256) throw new Error('Retained release integrity failed: ' + key)
    const response = await fetch('https://downloads.hulala.ai/' + key, { method: expected.static ? 'GET' : 'HEAD', signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error('Retained public download failed: ' + key)
    if (expected.static) {
      // Static Assets may compress text and omit Content-Length on HEAD.
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== expected.size || createHash('sha256').update(new Uint8Array(bytes)).digest('hex') !== expected.sha256) throw new Error('Retained static download failed integrity: ' + key)
    } else if (Number(response.headers.get('content-length')) !== expected.size) throw new Error('Retained public download size changed: ' + key)
    console.log('Verified retained ' + key)
  }
  const refreshed = await bucketInventory(client)
  const refreshedPlan = prunePlan(refreshed, catalog, policy)
  if (JSON.stringify(refreshedPlan) !== JSON.stringify(obsolete)) throw new Error('Inventory changed during verification; no deletion allowed')
  await assertDeployed()
  const deleted: string[] = []
  for (const object of obsolete) {
    // HEAD on text objects can be transformed (weak ETag / no Content-Length).
    // ListObjects reports the stored identity without HTTP compression effects.
    const page = await client.list({ prefix: object.key, maxKeys: 2 })
    const current = page.contents?.find(item => item.key === object.key)
    if (!current || Number(current.size) !== object.size || current.eTag !== object.etag) throw new Error('Cleanup candidate changed: ' + object.key)
    await client.delete(object.key)
    deleted.push(object.key)
    await writeFile(resolve(evidence, 'deleted.json'), JSON.stringify(deleted, null, 2))
  }
  const after = await bucketInventory(client)
  if (prunePlan(after, catalog, policy).length) throw new Error('Cleanup incomplete')
  await assertDeployed()
  await writeFile(resolve(evidence, 'result.json'), JSON.stringify({ policy, deleted, after, bytes: after.reduce((n, x) => n + x.size, 0) }, null, 2))
  console.log(`Retention complete: ${after.length} objects, ${(after.reduce((n, x) => n + x.size, 0) / 1e9).toFixed(3)} GB. Evidence: ${evidence}`)
}
