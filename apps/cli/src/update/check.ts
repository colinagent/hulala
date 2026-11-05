/**
 * Release update checks for the terminal client.
 *
 * `hulala update` always asks the release index; a normal startup only needs a
 * cheap reminder. The startup path therefore reads a short-lived cache under
 * the state root and turns every network or index failure into "no reminder":
 * an update check must never delay or break the client.
 *
 * Releases are stable-only, so a prerelease build reads the same line and is
 * offered the final release of that version.
 *
 * @module hulala-cli/update/check
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  compareVersions,
  DEFAULT_RELEASE_INDEX_URL,
  fetchReleaseIndex,
  type ReleaseIndex,
} from '@hulala/distribution/channels'
import { RELEASE_TARGETS, releaseTarget, type ReleaseTarget } from '@hulala/distribution/targets'
import { VERSION } from '../constants.js'
import { listCachedReleases } from '../distribution/releaseCache.js'
import { resolvePaths, type HulalaPaths } from '../paths.js'

/** A newer release the user can install. */
export interface UpdateInfo {
  readonly currentVersion: string
  readonly latestVersion: string
  /** True when the release archive is already downloaded and verified here. */
  readonly downloaded?: boolean
}

export interface UpdateCheckOptions {
  /** Version to compare against; defaults to this build's version. */
  currentVersion?: string
  /** Read and refresh the startup cache; defaults to true. */
  cache?: boolean
  /** Injected for tests; defaults to the process state root. */
  paths?: HulalaPaths
  /** Injected for tests; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Injected for tests; defaults to `Date.now()`. */
  now?: number
}

interface UpdateCache {
  format: 2
  endpoint: string
  target: ReleaseTarget
  checkedAt: number
  latestVersion: string
}

/** How long a startup result is reused. `hulala update` bypasses it. */
export const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000

const CACHE_FILE = 'update-check.json'

/** `HULALA_OFFLINE=0` still means online; the bare flag means offline. */
function disabledBy(value: string | undefined): boolean {
  if (value === undefined) return false
  return !['', '0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())
}

/** The index this process reads, including a local mirror override. */
export function releaseIndexEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  return env.HULALA_RELEASE_INDEX_URL?.trim() || DEFAULT_RELEASE_INDEX_URL
}

/**
 * Newest release that has an archive for this platform.
 *
 * Unlike {@link checkForUpdate} this is meant for `hulala update`, so a missing
 * index or release is reported to the caller instead of being ignored.
 * @param env - environment holding an optional mirror URL.
 * @param target - platform whose archive must exist; defaults to this machine.
 * @returns the advertised version, or undefined when the index has no stable
 *   release or the release has no archive for this platform.
 */
export async function latestRelease(
  env: NodeJS.ProcessEnv = process.env,
  target: ReleaseTarget = releaseTarget(),
): Promise<string | undefined> {
  const index = await fetchReleaseIndex(releaseIndexEndpoint(env))
  const version = index.channels.stable
  if (version === undefined) return undefined
  const release = index.releases.find(value => value.version === version)
  if (release === undefined || release.platforms[target] === undefined) return undefined
  return version
}

/**
 * Whether one explicit release ships an archive for this platform.
 *
 * `hulala update --check --version <x>` uses it so it never advertises a
 * release that `hulala update --version <x>` would then refuse to install.
 * @param version - exact release version to look up.
 * @param env - environment holding an optional mirror URL.
 * @param target - platform whose archive must exist; defaults to this machine.
 * @returns true when the release and a platform archive both exist.
 */
export async function releaseAvailable(
  version: string,
  env: NodeJS.ProcessEnv = process.env,
  target: ReleaseTarget = releaseTarget(),
): Promise<boolean> {
  const index = await fetchReleaseIndex(releaseIndexEndpoint(env))
  const release = index.releases.find(value => value.version === version)
  return release !== undefined && release.platforms[target] !== undefined
}

function cachePath(paths: HulalaPaths): string {
  return join(paths.data, 'cache', CACHE_FILE)
}

function validCache(value: unknown): value is UpdateCache {
  if (value === null || typeof value !== 'object') return false
  const cache = value as Partial<UpdateCache>
  return cache.format === 2
    && typeof cache.endpoint === 'string'
    && typeof cache.target === 'string'
    && Object.hasOwn(RELEASE_TARGETS, cache.target)
    && typeof cache.checkedAt === 'number'
    && Number.isFinite(cache.checkedAt)
    && typeof cache.latestVersion === 'string'
    && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(cache.latestVersion)
}

async function readCache(paths: HulalaPaths): Promise<UpdateCache | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(cachePath(paths), 'utf8'))
    return validCache(value) ? value : undefined
  } catch {
    // A missing, unreadable or stale cache only costs one network request.
    return undefined
  }
}

/** Write atomically; a reminder cache must never leave a partial file behind. */
async function writeCache(paths: HulalaPaths, cache: UpdateCache): Promise<void> {
  const file = cachePath(paths)
  const temporary = `${file}.${process.pid}.tmp`
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    await writeFile(temporary, `${JSON.stringify(cache)}\n`, { mode: 0o600 })
    await rename(temporary, file)
  } catch {
    // The state root may be read-only; updating still works without a cache.
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

function newer(latestVersion: string, currentVersion: string): UpdateInfo | undefined {
  try {
    if (compareVersions(latestVersion, currentVersion) <= 0) return undefined
  } catch {
    return undefined
  }
  return { currentVersion, latestVersion }
}

/**
 * Whether the release archive for one version is already downloaded.
 * @param version - release version.
 * @param paths - state root holding the release cache.
 * @returns true when a verified cached archive exists for this target.
 */
async function downloaded(version: string, paths: HulalaPaths): Promise<boolean> {
  const cached = await listCachedReleases(paths.data).catch(() => [])
  return cached.some(entry => entry.version === version && entry.sha256 !== undefined)
}

/**
 * Check whether a newer release exists.
 *
 * Startup calls this without blocking; `hulala update` asks the index directly
 * and never turns a stale reminder into an installation decision.
 * @param options - version, cache and test seams.
 * @returns the newer release, or undefined when current, offline or unknown.
 */
export async function checkForUpdate(options: UpdateCheckOptions = {}): Promise<UpdateInfo | undefined> {
  const env = options.env ?? process.env
  if (disabledBy(env.HULALA_OFFLINE) || disabledBy(env.HULALA_SKIP_UPDATE_CHECK) || disabledBy(env.NO_UPDATE_NOTIFIER)) {
    return undefined
  }

  const currentVersion = options.currentVersion ?? VERSION
  const endpoint = releaseIndexEndpoint(env)
  const paths = options.paths ?? resolvePaths(process.platform, env)
  const now = options.now ?? Date.now()
  const useCache = options.cache !== false
  let target: ReleaseTarget
  try {
    target = releaseTarget()
  } catch {
    // A platform with no release archive gets no update reminder.
    return undefined
  }

  if (useCache) {
    const cached = await readCache(paths)
    if (
      cached !== undefined
      && cached.endpoint === endpoint
      && cached.target === target
      && cached.checkedAt <= now
      && now - cached.checkedAt < UPDATE_CACHE_TTL_MS
    ) {
      const remembered = newer(cached.latestVersion, currentVersion)
      if (remembered === undefined) return undefined
      return await downloaded(remembered.latestVersion, paths) ? { ...remembered, downloaded: true } : remembered
    }
  }

  let index: ReleaseIndex
  try {
    index = await fetchReleaseIndex(endpoint)
  } catch {
    return undefined
  }
  const latestVersion = index.channels.stable
  if (latestVersion === undefined) return undefined
  const release = index.releases.find(value => value.version === latestVersion)
  if (release === undefined || release.platforms[target] === undefined) return undefined

  if (useCache) await writeCache(paths, { format: 2, endpoint, target, checkedAt: now, latestVersion })
  const info = newer(latestVersion, currentVersion)
  if (info === undefined) return undefined
  return await downloaded(info.latestVersion, paths) ? { ...info, downloaded: true } : info
}
