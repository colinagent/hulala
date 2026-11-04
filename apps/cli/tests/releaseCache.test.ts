import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releaseTarget } from '@hulala/distribution/targets'
import {
  compareReleaseVersions,
  listCachedReleases,
  pruneReleaseCache,
  releaseArchivePath,
  writeReleaseSidecar,
} from '../src/distribution/releaseCache.js'

/** Put a fake archive (and optionally its sidecar) into the cache. */
async function cache(data: string, version: string, sha256?: string): Promise<string> {
  const archive = releaseArchivePath(data, version)
  await mkdir(join(archive, '..'), { recursive: true })
  await writeFile(archive, version)
  if (sha256 !== undefined) await writeReleaseSidecar(archive, { sha256, dataFormat: 1, manifestSha256: 'b'.repeat(64) })
  return archive
}

test('cached releases are listed newest first and keep their index facts', async () => {
  const data = await mkdtemp(join(tmpdir(), 'hulala cache '))
  try {
    await cache(data, '0.1.9', 'a'.repeat(64))
    await cache(data, '0.1.15', 'c'.repeat(64))
    await cache(data, '0.1.10', 'b'.repeat(64))
    const listed = await listCachedReleases(data)
    expect(listed.map(entry => entry.version)).toEqual(['0.1.15', '0.1.10', '0.1.9'])
    expect(listed[0]?.sha256).toBe('c'.repeat(64))
    expect(listed[0]?.archive).toBe(releaseArchivePath(data, '0.1.15'))
  } finally { await rm(data, { recursive: true, force: true }) }
})

test('a directory without an archive is not an installable release', async () => {
  const data = await mkdtemp(join(tmpdir(), 'hulala cache '))
  try {
    await mkdir(join(data, 'cache', 'releases', '0.1.16'), { recursive: true })
    await cache(data, '0.1.15', 'a'.repeat(64))
    // A half-finished download is only a .part file.
    await writeFile(join(data, 'cache', 'releases', '0.1.15', `${releaseTarget()}-0.1.15.tar.gz.part`), 'partial')
    const listed = await listCachedReleases(data)
    expect(listed.map(entry => entry.version)).toEqual(['0.1.15'])
  } finally { await rm(data, { recursive: true, force: true }) }
})

test('pruning keeps only the installed version and drops partial downloads', async () => {
  const data = await mkdtemp(join(tmpdir(), 'hulala cache '))
  try {
    await cache(data, '0.1.9', 'a'.repeat(64))
    await cache(data, '0.1.10', 'b'.repeat(64))
    const keep = await cache(data, '0.1.15', 'c'.repeat(64))
    await writeFile(`${keep}.part`, 'partial')
    const removed = await pruneReleaseCache(data, '0.1.15')
    expect(removed).toEqual(['0.1.9', '0.1.10'])
    expect(await readdir(join(data, 'cache', 'releases'))).toEqual(['0.1.15'])
    // The archive and the index facts that make it installable offline remain.
    expect(await readdir(join(data, 'cache', 'releases', '0.1.15'))).toEqual([
      `${releaseTarget()}-0.1.15.tar.gz`,
      `${releaseTarget()}-0.1.15.tar.gz.json`,
    ])
  } finally { await rm(data, { recursive: true, force: true }) }
})

test('versions compare numerically, not as strings', () => {
  expect(compareReleaseVersions('0.1.15', '0.1.9')).toBeGreaterThan(0)
  expect(compareReleaseVersions('0.1.15', '0.1.15')).toBe(0)
  expect(compareReleaseVersions('0.1.9', '0.1.15')).toBeLessThan(0)
  expect(compareReleaseVersions('0.2.0', '0.1.99')).toBeGreaterThan(0)
})
