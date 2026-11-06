import { downloadUrl } from './archive.js'
import { curlText, useCurl } from './net.js'
import { releaseTarget, RELEASE_TARGETS, type ReleaseTarget } from './targets.js'

/** Dependency install facts for one target: the npm lock and the fallback pack. */
export interface RuntimeAsset {
  /** `package-lock.json` fed to `npm ci`. */
  lock: { url: string; sha256: string }
  /** Pre-installed, patched tree used when npm cannot be used. */
  pack: { url: string; sha256: string }
}
export interface ReleaseAsset { url: string; sha256: string; manifestSha256: string; runtime?: RuntimeAsset }
export interface Release { version: string; dataFormat: number; platforms: Partial<Record<ReleaseTarget, ReleaseAsset>> }
export interface ReleaseIndex { format: 1; product: 'hulala'; channels: { stable?: string; preview?: string }; releases: Release[] }
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/
const validVersion = (value: unknown): value is string => typeof value === 'string' && value.length <= 128 && versionPattern.test(value) && !value.split('-').slice(1).join('-').split('.').some(part => /^0\d+$/.test(part))
export function compareVersions(left: string, right: string): number {
  if (!validVersion(left) || !validVersion(right)) throw new Error('Invalid release version')
  const parse = (value: string) => { const [core, ...suffix] = value.split('-'); return { core: core!.split('.').map(BigInt), suffix: suffix.length ? suffix.join('-').split('.') : undefined } }
  const a = parse(left), b = parse(right)
  for (let index = 0; index < 3; index++) if (a.core[index] !== b.core[index]) return a.core[index]! > b.core[index]! ? 1 : -1
  if (!a.suffix || !b.suffix) return a.suffix ? -1 : b.suffix ? 1 : 0
  for (let index = 0; index < Math.max(a.suffix.length, b.suffix.length); index++) {
    const x = a.suffix[index], y = b.suffix[index]
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y)
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1
    if (nx !== ny) return nx ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}
export function parseReleaseIndex(value: any): ReleaseIndex {
  if (value?.format !== 1 || value.product !== 'hulala' || !value.channels || !Array.isArray(value.releases) || value.releases.length > 1000) throw new Error('Invalid Hulala release index')
  const versions = new Set<string>()
  for (const release of value.releases) {
    if (!validVersion(release.version) || versions.has(release.version) || !Number.isInteger(release.dataFormat) || release.dataFormat < 1 || !release.platforms || typeof release.platforms !== 'object') throw new Error('Invalid release record')
    versions.add(release.version)
    for (const [target, asset] of Object.entries(release.platforms) as Array<[string, any]>) {
      if (!Object.hasOwn(RELEASE_TARGETS, target) || typeof asset?.url !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256) || !/^[a-f0-9]{64}$/.test(asset.manifestSha256)) throw new Error('Invalid release platform asset')
      downloadUrl(asset.url)
      if (asset.runtime !== undefined) {
        for (const part of ['lock', 'pack'] as const) {
          const value = asset.runtime[part]
          if (typeof value?.url !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error(`Invalid release runtime asset: ${part}`)
          downloadUrl(value.url)
        }
      }
    }
  }
  for (const channel of ['stable', 'preview']) {
    const version = value.channels[channel]
    if (version !== undefined && (typeof version !== 'string' || !versions.has(version) || (channel === 'stable' && version.includes('-')))) throw new Error('Invalid release channel')
  }
  return value
}
export const DEFAULT_RELEASE_INDEX_URL = 'https://hulala.ai/web-releases.json'
export async function fetchReleaseIndex(endpoint = process.env.HULALA_RELEASE_INDEX_URL || DEFAULT_RELEASE_INDEX_URL): Promise<ReleaseIndex> {
  // Node ignores proxy variables, so behind a proxy the index is fetched with
  // curl; Bun's fetch already honours them.
  let text: string
  if (useCurl()) {
    text = await curlText(downloadUrl(endpoint).href, 10)
  } else {
    const response = await fetch(downloadUrl(endpoint), { signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`Hulala release index is unavailable (HTTP ${response.status}). A local build can use --from with a verified package.`)
    text = await response.text()
  }
  if (text.length > 4 * 1024 * 1024) throw new Error('Release index is too large')
  return parseReleaseIndex(JSON.parse(text))
}
export async function selectRelease(input: { version?: string; channel?: string }, target = releaseTarget()): Promise<{ release: Release; asset: ReleaseAsset }> {
  const index = await fetchReleaseIndex(), version = input.version || index.channels[(input.channel || 'stable') as 'stable' | 'preview']
  const release = index.releases.find(value => value.version === version), asset = release?.platforms[target]
  if (!release || !asset) throw new Error('The selected release is not available for ' + target)
  return { release, asset }
}
