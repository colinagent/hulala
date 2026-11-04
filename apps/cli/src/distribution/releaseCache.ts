/**
 * The downloaded-release cache under `<state>/cache/releases/`.
 *
 * `hulala update --download-only` and a detached `--background` run both land
 * here, so several versions can be present at once. The rules are:
 *
 * - one directory per version, holding the archive and a sidecar with the
 *   release index facts (digest, data format, manifest digest) so an offline
 *   `hulala update` can install without asking the network anything;
 * - `hulala update` installs the newest version it can find, using the cached
 *   bytes when they are already there;
 * - a successful install deletes every other cached version, so the cache never
 *   becomes a private archive of the whole release history.
 *
 * @module hulala-cli/distribution/release-cache
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { releaseTarget } from '@hulala/distribution/targets'

/** One downloaded release archive plus the index facts that came with it. */
export interface CachedRelease {
  /** `0.1.15` and friends. */
  readonly version: string
  /** Absolute path of the archive. */
  readonly archive: string
  /** Pinned digest from the release index; absent when the sidecar is missing. */
  readonly sha256?: string
  /** Package data format, when the index stated one. */
  readonly dataFormat?: number
  /** Digest of the package's `manifest.json`, when the index stated one. */
  readonly manifestSha256?: string
}

/** Directory holding every cached release for this machine. */
export function releaseCacheRoot(data: string): string {
  return join(data, 'cache', 'releases')
}

/** Directory for one release version. */
export function releaseCacheDir(data: string, version: string): string {
  return join(releaseCacheRoot(data), version)
}

/** Archive path for one release version on this target. */
export function releaseArchivePath(data: string, version: string): string {
  return join(releaseCacheDir(data, version), `${releaseTarget()}-${version}.tar.gz`)
}

function sidecarPath(archive: string): string {
  return `${archive}.json`
}

/**
 * Compare two `x.y.z` versions.
 * @param left - first version.
 * @param right - second version.
 * @returns negative, zero or positive like a comparator.
 */
export function compareReleaseVersions(left: string, right: string): number {
  const parse = (value: string): number[] => value.split('.').map(part => Number(part.replace(/-.*$/, '')) || 0)
  const a = parse(left), b = parse(right)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * Record the release index facts next to a downloaded archive.
 * @param archive - the downloaded archive path.
 * @param facts - digest and package identity from the index.
 */
export async function writeReleaseSidecar(archive: string, facts: Omit<CachedRelease, 'version' | 'archive'>): Promise<void> {
  await writeFile(sidecarPath(archive), `${JSON.stringify(facts)}\n`, { mode: 0o600 })
}

/**
 * Every cached release for this target, newest first.
 *
 * A directory without a matching archive is ignored (a download that never
 * finished); the archive is what makes a version installable.
 * @param data - the state root.
 * @returns the cached releases, newest first.
 */
export async function listCachedReleases(data: string): Promise<CachedRelease[]> {
  const root = releaseCacheRoot(data)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const releases: CachedRelease[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(entry.name)) continue
    const version = entry.name
    const archive = releaseArchivePath(data, version)
    if (!await stat(archive).then(value => value.isFile(), () => false)) continue
    const facts = await readFile(sidecarPath(archive), 'utf8')
      .then(value => JSON.parse(value) as Omit<CachedRelease, 'version' | 'archive'>)
      .catch(() => undefined)
    releases.push({ version, archive, ...(facts ?? {}) })
  }
  return releases.sort((a, b) => compareReleaseVersions(b.version, a.version))
}

/**
 * Delete every cached release except one, including half-finished downloads.
 * @param data - the state root.
 * @param keep - the version that stays, or undefined to empty the cache.
 * @returns the versions that were removed.
 */
export async function pruneReleaseCache(data: string, keep: string | undefined): Promise<string[]> {
  const root = releaseCacheRoot(data)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(entry.name)) continue
    if (entry.name === keep) {
      // Within the kept version, a stale partial download is still garbage.
      const archive = releaseArchivePath(data, keep)
      await rm(`${archive}.part`, { force: true })
      continue
    }
    await rm(join(root, entry.name), { recursive: true, force: true })
    removed.push(entry.name)
  }
  return removed.sort(compareReleaseVersions)
}

/**
 * Digest of a cached archive, computed once and remembered in the sidecar.
 * @param release - cached release.
 * @returns the SHA-256 of the archive bytes.
 */
export async function cachedReleaseDigest(release: CachedRelease): Promise<string> {
  if (release.sha256 !== undefined) return release.sha256
  const hash = createHash('sha256')
  const { createReadStream } = await import('node:fs')
  for await (const chunk of createReadStream(release.archive)) hash.update(chunk)
  return hash.digest('hex')
}
