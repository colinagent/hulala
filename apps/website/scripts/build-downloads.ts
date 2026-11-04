import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import catalog from '../downloads/catalog.json'
import type { Download } from '../downloads/gateway'
import retention from '../downloads/retention.json'
import { latestOnlyCatalog } from '../../../scripts/release/r2Retention'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
const destination = resolve(root, 'dist/downloads')
const client = process.env.R2_API_ID && process.env.R2_API_KEY && process.env.OPAGENT_R2_ENDPOINT
  ? new Bun.S3Client({ endpoint: process.env.OPAGENT_R2_ENDPOINT, bucket: 'hulala-downloads', accessKeyId: process.env.R2_API_ID, secretAccessKey: process.env.R2_API_KEY, region: 'auto' }) : undefined
if (!catalog.length) throw new Error('Download catalog is empty')
if (JSON.stringify(latestOnlyCatalog(catalog, retention)) !== JSON.stringify(catalog)) throw new Error('Catalog does not implement the current latest-only retention policy')
await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })
let headers = '/*\n  X-Content-Type-Options: nosniff\n  Cache-Control: public, max-age=60, must-revalidate\n'
let count = 0
for (const item of catalog as Download[]) {
  if (!/^hulala\/(web|desktop)\//.test(item.key) || item.key.split('/').some(x => !x || x === '.' || x === '..') || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid download catalog entry')
  if (!item.static || item.retired) continue
  if (item.size > 2_000_000) throw new Error('Static metadata too large')
  const response = client ? client.file(item.objectKey ?? item.key) : await fetch('https://downloads.hulala.ai/' + (item.objectKey ?? item.key), { signal: AbortSignal.timeout(30_000) })
  if (response instanceof Response && !response.ok) throw new Error(`Metadata fetch failed: ${item.key} (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length !== item.size || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`Metadata integrity failed: ${item.key}`)
  const target = resolve(destination, item.key)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, bytes)
  const contentType = item.key.endsWith('.json') ? 'application/json' : item.key.endsWith('.blockmap') ? 'application/octet-stream' : 'text/plain; charset=utf-8'
  headers += `/${item.key}\n  Content-Type: ${contentType}\n`
  count++
}
const catalogSha256 = createHash('sha256').update(JSON.stringify(catalog)).digest('hex')
await writeFile(resolve(destination, '_release-state.json'), JSON.stringify({ format: 1, catalogSha256, retention }))
headers += '/_release-state.json\n  Cache-Control: no-store\n  Content-Type: application/json\n'
await writeFile(resolve(destination, '_headers'), headers)
console.log(`Prepared ${count} hash-verified static download metadata paths; ${catalog.filter(item => !item.retired && !item.static).length} binary paths remain quota-protected; ${catalog.filter(item => item.retired).length} retired paths never read R2.`)
