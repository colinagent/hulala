import { expect, test } from 'bun:test'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { createGzip } from 'node:zlib'
import { pack, type Header } from 'tar-stream'
import { downloadArchive, downloadUrl, fileSha256, unpackRelease } from '@hulala/distribution/archive'
import { packageFiles } from '@hulala/distribution/manifest'
import { fixture } from './fixtures/package.js'

/** Digest of an in-memory payload, for the download tests. */
function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function tarball(path: string, entries: Array<{ header: Partial<Header> & { name: string }; body?: Uint8Array | string }>) {
  const writer = pack(), writing = pipeline(writer, createGzip(), createWriteStream(path))
  for (const entry of entries) writer.entry(entry.header, entry.body ?? '')
  writer.finalize(); await writing
}

test('extracts a verified canonical package with executable permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala archive '))
  try {
    const source = await fixture(root, '1.0.0'), archive = join(root, 'package.tar.gz')
    const files = [...await packageFiles(source), { path: 'manifest.json', mode: 0o644 }]
    await tarball(archive, await Promise.all(files.map(async file => ({ header: { name: 'hulala/' + file.path, mode: file.mode ?? 0o644, type: 'file' as const }, body: await readFile(join(source, file.path)) }))))
    const result = await unpackRelease(archive, join(root, 'extract'), await fileSha256(archive))
    expect(await readFile(join(result.directory, 'runtime/host.mjs'), 'utf8')).toBe('1.0.0:runtime/host.mjs')
    await expect(unpackRelease(archive, join(root, 'bad-digest'), '0'.repeat(64))).rejects.toThrow('SHA-256')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects traversal, links, special files and duplicate entries without writing outside staging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala unsafe archive '))
  try {
    await writeFile(join(root, 'outside'), 'sentinel')
    const cases: Array<Array<{ header: Partial<Header> & { name: string }; body?: string }>> = [
      [{ header: { name: '../outside' }, body: 'overwrite' }],
      [{ header: { name: '/absolute/file' }, body: 'overwrite' }],
      [{ header: { name: 'hulala/a/../../outside' }, body: 'overwrite' }],
      [{ header: { name: 'hulala/a\\outside' }, body: 'overwrite' }],
      [{ header: { name: 'hulala/C:stream' }, body: 'overwrite' }],
      [{ header: { name: 'hulala/link', type: 'symlink', linkname: '../../outside' } }],
      [{ header: { name: 'hulala/link', type: 'link', linkname: '../../outside' } }],
      [{ header: { name: 'hulala/pipe', type: 'fifo' } }],
      [{ header: { name: 'hulala/file' }, body: 'one' }, { header: { name: 'hulala/file' }, body: 'two' }],
    ]
    for (let index = 0; index < cases.length; index++) {
      const archive = join(root, index + '.tar.gz'), parent = join(root, 'out-' + index)
      await tarball(archive, cases[index]!)
      await expect(unpackRelease(archive, parent, await fileSha256(archive))).rejects.toThrow(/Unsafe|Duplicate/)
      expect(await readdir(parent)).toEqual([])
      expect(await readFile(join(root, 'outside'), 'utf8')).toBe('sentinel')
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('download verification preserves prior files and removes failed temporary downloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala download '))
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('archive fixture') })
  try {
    const original = join(root, 'original'); await writeFile(original, 'archive fixture')
    const hash = await fileSha256(original), target = join(root, 'download')
    await downloadArchive(`http://127.0.0.1:${server.port}/asset`, target, hash)
    expect(await readFile(target, 'utf8')).toBe('archive fixture')
    await expect(downloadArchive(`http://127.0.0.1:${server.port}/asset`, target, hash)).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe('archive fixture')
    const rejected = join(root, 'rejected')
    await expect(downloadArchive(`http://127.0.0.1:${server.port}/asset`, rejected, '0'.repeat(64))).rejects.toThrow('SHA-256')
    expect(await Bun.file(rejected).exists()).toBe(false)
    expect(() => downloadUrl('http://example.com/archive')).toThrow('HTTPS')
    expect(() => downloadUrl('https://user:synthetic@example.com/archive')).toThrow('HTTPS')
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }) }
})

test('a partial download resumes with a Range request instead of starting over', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala resume '))
  const payload = new Uint8Array(200_000).map((_, index) => index % 251)
  const ranges: Array<string | null> = []
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(request) {
      const range = request.headers.get('range')
      ranges.push(range)
      if (range !== null) {
        const start = Number(/^bytes=(\d+)-$/.exec(range)?.[1])
        const slice = payload.slice(start)
        return new Response(slice, {
          status: 206,
          headers: { 'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}`, 'content-length': String(slice.length) },
        })
      }
      return new Response(payload, { headers: { 'content-length': String(payload.length) } })
    },
  })
  try {
    const target = join(root, 'release.tar.gz')
    const half = payload.length / 2
    await writeFile(target + '.part', payload.slice(0, half))
    await downloadArchive(`http://127.0.0.1:${server.port}/asset`, target, await sha256Of(payload))
    expect(ranges).toEqual([`bytes=${half}-`])
    expect(new Uint8Array(await readFile(target))).toEqual(payload)
    expect(await Bun.file(target + '.part').exists()).toBe(false)
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }) }
})

test('a server that ignores the range restarts cleanly instead of corrupting the file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala restart '))
  const payload = new Uint8Array(4096).fill(7)
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(payload) })
  try {
    const target = join(root, 'release.tar.gz')
    await writeFile(target + '.part', payload.slice(0, 1024))
    await downloadArchive(`http://127.0.0.1:${server.port}/asset`, target, await sha256Of(payload))
    expect(new Uint8Array(await readFile(target))).toEqual(payload)
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }) }
})

test('a stalled transfer gives up and keeps the partial file for the next try', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala stall '))
  // Headers and a first chunk arrive, then the connection goes quiet: the case a
  // total timeout would mask and a stall window has to catch.
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch: () => new Response(
      new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(10)) },
      }),
      { headers: { 'content-length': '1000' } },
    ),
  })
  try {
    const target = join(root, 'release.tar.gz')
    await expect(
      downloadArchive(`http://127.0.0.1:${server.port}/asset`, target, 'a'.repeat(64), { stallMs: 150 }),
    ).rejects.toThrow()
    expect(await Bun.file(target).exists()).toBe(false)
    expect(await Bun.file(target + '.part').exists()).toBe(true)
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }) }
})
