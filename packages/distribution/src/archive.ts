import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { extract } from 'tar-stream'
import { safePackagePath, verifyPackage } from './manifest.js'

const MAX_DOWNLOAD = 1024 * 1024 * 1024
const MAX_EXPANDED = 2 * MAX_DOWNLOAD
export async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export function downloadUrl(value: string): URL {
  const url = new URL(value)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Downloads require HTTPS (or loopback for a local mirror)')
  return url
}
export async function downloadArchive(url: string, destination: string, expectedSha256: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('A pinned SHA-256 is required')
  let current = downloadUrl(url), response: Response | undefined
  for (let redirect = 0; redirect < 6; redirect++) {
    try { response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(120000) }) }
    catch { throw new Error('Download failed from ' + current.hostname) }
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) { current = downloadUrl(new URL(response.headers.get('location')!, current).href); await response.body?.cancel(); continue }
    break
  }
  if (!response?.ok || !response.body) throw new Error('Download failed with HTTP ' + response?.status)
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_DOWNLOAD) { await response.body.cancel(); throw new Error('Release archive exceeds the download limit') }
  const file = await open(destination, 'wx', 0o600).catch(async error => { await response!.body!.cancel(); throw error })
  let bytes = 0
  let complete = false
  const hash = createHash('sha256')
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength
      if (bytes > MAX_DOWNLOAD) throw new Error('Release archive exceeds the download limit')
      hash.update(chunk)
      let offset = 0
      while (offset < chunk.byteLength) {
        const result = await file.write(chunk, offset, chunk.byteLength - offset)
        if (!result.bytesWritten) throw new Error('Could not write release archive')
        offset += result.bytesWritten
      }
    }
    if (hash.digest('hex') !== expectedSha256) throw new Error('Downloaded archive SHA-256 mismatch')
    complete = true
  } finally { await file.close(); if (!complete) await rm(destination, { force: true }) }
}

/** Read tar metadata before creating each entry. No archive path, link, device,
 * ownership, setuid bit or pre-existing output file is trusted. */
export async function unpackRelease(archive: string, parent: string, expectedSha256: string): Promise<{ directory: string; staging: string }> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || await fileSha256(archive) !== expectedSha256) throw new Error('Release archive SHA-256 mismatch')
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const staging = await mkdtemp(join(parent, '.extract-'))
  const parser = extract()
  let total = 0, entries = 0, expanded = 0, top: string | undefined
  const names = new Set<string>()
  const source = createReadStream(archive), unzip = createGunzip()
  const limit = new Transform({ transform(chunk, _encoding, callback) {
    expanded += chunk.length
    callback(expanded > MAX_EXPANDED + 128 * 1024 * 1024 ? new Error('Expanded archive exceeds the limit') : null, chunk)
  } })
  const pumping = pipeline(source, unzip, limit, parser)
  let writing: Promise<void> | undefined
  try {
    writing = (async () => {
      for await (const entry of parser) {
        const header = entry.header
        const directory = header.type === 'directory'
        const name = directory ? header.name.replace(/\/$/, '') : header.name
        if (!safePackagePath(name) || (!directory && header.type !== 'file') || header.linkname) throw new Error('Unsafe archive path or entry type')
        if (!Number.isSafeInteger(header.size) || header.size < 0 || (directory && header.size !== 0)) throw new Error('Invalid archive entry size')
        total += header.size; entries++
        if (entries > 60000 || total > MAX_EXPANDED) throw new Error('Archive exceeds the extraction limit')
        const key = process.platform === 'linux' ? name : name.toLowerCase()
        if (names.has(key)) throw new Error('Duplicate archive entry')
        names.add(key)
        const parts = name.split('/')
        top ??= parts[0]
        if (parts[0] !== top || (!directory && parts.length < 2)) throw new Error('Release archive must contain one package directory')
        if (process.platform === 'win32' && parts.some(part => /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Unsupported Windows archive path')
        const target = join(staging, ...parts)
        if (directory) { await mkdir(target, { recursive: true, mode: 0o755 }); entry.resume() }
        else {
          await mkdir(dirname(target), { recursive: true, mode: 0o755 })
          await pipeline(entry, createWriteStream(target, { flags: 'wx', mode: (header.mode ?? 0o644) & 0o755 }))
        }
      }
    })()
    await Promise.all([pumping, writing])
    if (!top) throw new Error('Empty release archive')
    const directory = join(staging, top)
    await verifyPackage(directory)
    return { directory, staging }
  } catch (error) {
    source.destroy(); unzip.destroy(); limit.destroy(); parser.destroy(error instanceof Error ? error : new Error('Archive extraction failed'))
    await Promise.allSettled([pumping, writing])
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}
