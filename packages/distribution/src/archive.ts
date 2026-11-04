import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, open, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { extract } from 'tar-stream'
import { safePackagePath, verifyPackage } from './manifest.js'
import { curlFile, useCurl } from './net.js'

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
/** Options for a resumable download. */
export interface DownloadOptions {
  /** Bytes received so far, and the total whenever the server reports one. */
  onProgress?: (received: number, total: number | undefined) => void
  /** Caller-side abort; the partial file is kept for the next attempt. */
  signal?: AbortSignal
  /** Abort when no bytes arrive for this long. A stalled transfer keeps its part. */
  stallMs?: number
}

const CONNECT_TIMEOUT = 30_000
const STALL_TIMEOUT = 90_000

/**
 * Download an archive, resuming whatever a previous attempt left behind.
 *
 * A 150 MB release over a slow link must not have to start over: the bytes land
 * in `<destination>.part` and the next attempt asks for the rest with a `Range`
 * header. The timeout is a **stall** timeout, not a total one — a slow but
 * moving transfer is fine, a dead one is abandoned after `stallMs` and its part
 * is kept. Only a SHA-256 mismatch discards the part, because those bytes can
 * never become valid.
 *
 * @param url - HTTPS (or loopback) archive URL.
 * @param destination - final path; refuses to overwrite an existing file.
 * @param expectedSha256 - pinned digest of the complete archive.
 * @param options - progress, caller abort and stall window.
 */
export async function downloadArchive(url: string, destination: string, expectedSha256: string, options: DownloadOptions = {}): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('A pinned SHA-256 is required')
  if (useCurl()) {
    // Node's fetch cannot use the proxy this machine needs; curl can, and it
    // resumes the same `.part` file the fetch path would have written.
    await curlFile(url, destination, {
      ...(options.stallMs === undefined ? {} : { stallSeconds: Math.round(options.stallMs / 1000) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    })
    const part = destination + '.part'
    if (await fileSha256(part) !== expectedSha256) { await rm(part, { force: true }); throw new Error('Downloaded archive SHA-256 mismatch') }
    if (await stat(destination).then(() => true, () => false)) throw new Error('Download destination already exists')
    await rename(part, destination)
    return
  }
  const part = destination + '.part'
  const stallMs = options.stallMs ?? STALL_TIMEOUT
  let offset = await stat(part).then(entry => entry.size, () => 0)
  if (Number.isNaN(offset) || offset > MAX_DOWNLOAD) { await rm(part, { force: true }); offset = 0 }

  let current = downloadUrl(url)
  let response: Response | undefined
  const controller = new AbortController()
  const signal = options.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, options.signal])
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (ms: number): void => { if (timer !== undefined) clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error('stalled')), ms) }
  const disarm = (): void => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  try {
    for (let redirect = 0; redirect < 6; redirect++) {
      arm(CONNECT_TIMEOUT)
      try {
        response = await fetch(current, { redirect: 'manual', signal, headers: offset > 0 ? { range: `bytes=${offset}-` } : {} })
      } catch { throw new Error('Download failed from ' + current.hostname) }
      if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
        current = downloadUrl(new URL(response.headers.get('location')!, current).href)
        await response.body?.cancel()
        continue
      }
      break
    }
    if (response === undefined) throw new Error('Download failed: too many redirects')
    // The server ignored the range (fresh 200) or the part is no longer valid.
    if (offset > 0 && response.status === 200) { offset = 0; await rm(part, { force: true }) }
    if (offset > 0 && response.status === 416) { offset = 0; await response.body?.cancel(); await rm(part, { force: true }); throw new Error('Resume rejected by the server; retry the download') }
    if (offset > 0 && response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('content-range') ?? '')
      if (range === null || Number(range[1]) !== offset) { await response.body?.cancel(); await rm(part, { force: true }); throw new Error('Server resumed at the wrong offset; retry the download') }
    }
    if (!response.ok || !response.body) throw new Error('Download failed with HTTP ' + response.status)
    const declared = Number(response.headers.get('content-length') || 0)
    const total = declared > 0 ? declared + offset : undefined
    if (total !== undefined && total > MAX_DOWNLOAD) { await response.body.cancel(); throw new Error('Release archive exceeds the download limit') }

    const file = await open(part, offset === 0 ? 'w' : 'a', 0o600)
    let received = offset
    let complete = false
    let lastReport = 0
    let stallTimer: ReturnType<typeof setTimeout> | undefined
    const reader = response.body.getReader()
    try {
      for (;;) {
        // Re-arm on every chunk: this both clears the connect window that was
        // armed before the headers arrived (it must not fire mid-transfer) and
        // restarts the stall window that a quiet connection has to outlast.
        arm(stallMs)
        // The abort alone does not interrupt a body that has stopped producing
        // chunks, so the read itself is raced against the same stall window.
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            stallTimer = setTimeout(() => {
              controller.abort(new Error('stalled'))
              reject(new Error(`Download stalled: no data for ${Math.round(stallMs / 1000)}s (partial file kept)`))
            }, stallMs)
          }),
        ]).finally(() => { if (stallTimer !== undefined) clearTimeout(stallTimer); stallTimer = undefined })
        if (next.done) break
        const chunk = next.value as Uint8Array
        received += chunk.byteLength
        if (received > MAX_DOWNLOAD) throw new Error('Release archive exceeds the download limit')
        let written = 0
        while (written < chunk.byteLength) {
          const result = await file.write(chunk, written, chunk.byteLength - written)
          if (!result.bytesWritten) throw new Error('Could not write release archive')
          written += result.bytesWritten
        }
        const now = Date.now()
        if (options.onProgress !== undefined && (now - lastReport > 200 || received === total)) {
          lastReport = now
          options.onProgress(received, total)
        }
      }
      complete = true
    } finally {
      disarm()
      await reader.cancel().catch(() => undefined)
      await file.close()
    }
    if (!complete) throw new Error('Download incomplete')
    if (total !== undefined && received !== total) { await rm(part, { force: true }); throw new Error('Downloaded archive is shorter than the server announced') }
    if (await fileSha256(part) !== expectedSha256) { await rm(part, { force: true }); throw new Error('Downloaded archive SHA-256 mismatch') }
    // A final destination that exists is never overwritten, same as before.
    if (await stat(destination).then(() => true, () => false)) throw new Error('Download destination already exists')
    await rename(part, destination)
  } catch (error) {
    disarm()
    // Keep the partial file for the next attempt unless the bytes were wrong.
    throw error
  }
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
