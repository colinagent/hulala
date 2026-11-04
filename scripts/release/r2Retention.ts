import type { Download } from '../../apps/website/downloads/gateway'
import type { SizedObject } from './r2Capacity'

export interface Retention { web: string; desktop: string }
export const products = ['web', 'desktop'] as const
/**
 * Targets the terminal client ships for. The TUI archives carry the client and
 * the embedded Host in one package, so there is no separate installer binary
 * and no Windows build.
 */
export const RELEASE_TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] as const

export function releaseFiles(product: keyof Retention, version: string): string[] {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Retention requires an explicit stable version')
  const names = product === 'web'
    ? RELEASE_TARGETS.map(target => `hulala-${version}-${target}.tar.gz`).concat(['install.sh', 'web-releases.json', 'SHASUMS256.txt'])
    : [`Hulala-${version}-arm64.dmg`, `Hulala-${version}-arm64-mac.zip`, `Hulala-${version}-arm64-mac.zip.blockmap`,
      `Hulala-Setup-${version}.exe`, `Hulala-Setup-${version}.exe.blockmap`, 'latest-mac.yml', 'latest.yml', 'manifest.json', 'SHA256SUMS']
  return names.map(name => `hulala/${product}/${version}/${name}`)
}

export function retainedKeys(policy: Retention): Set<string> {
  return new Set(products.flatMap(product => releaseFiles(product, policy[product])))
}

export function validateReleaseMetadata(product: keyof Retention, version: string, metadata: unknown, files: { key: string; sha256: string }[]): void {
  const data = metadata as { version?: string; channels?: { stable?: string }; releases?: { version: string; platforms: Record<string, { url: string; sha256: string }> }[]; assets?: Record<string, { url: string; sha256: string }> }
  let assets: { url: string; sha256: string }[]
  if (product === 'web') {
    const release = data.releases?.find(x => x.version === version)
    if (data.channels?.stable !== version || !release || RELEASE_TARGETS.some(x => !release.platforms?.[x])) throw new Error('Web index does not promote the complete new version')
    if (Object.keys(release.platforms ?? {}).some(x => !(RELEASE_TARGETS as readonly string[]).includes(x))) throw new Error('Web index advertises a platform the terminal client does not ship')
    assets = Object.values(release.platforms)
  } else {
    if (data.version !== version || !data.assets || ['dmg', 'zip', 'windowsInstaller'].some(x => !data.assets?.[x])) throw new Error('Desktop manifest does not describe the new version')
    assets = Object.values(data.assets)
  }
  for (const asset of assets) {
    const url = new URL(asset.url)
    if (url.origin !== 'https://downloads.hulala.ai' || url.search || url.hash || !url.pathname.startsWith(`/hulala/${product}/${version}/`)) throw new Error('Release metadata points outside the canonical new release')
    if (!files.some(file => '/' + file.key === url.pathname && file.sha256 === asset.sha256)) throw new Error('Release metadata integrity does not match the upload plan')
  }
}

export function latestOnlyCatalog(catalog: Download[], policy: Retention): Download[] {
  const keep = retainedKeys(policy)
  const existing = new Map(catalog.map(x => [x.key, x]))
  if (existing.size !== catalog.length) throw new Error('Duplicate catalog keys')
  for (const key of keep) {
    const item = existing.get(key)
    if (!item || item.retired || item.objectKey || !Number.isSafeInteger(item.size) || item.size <= 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Incomplete current release: ' + key)
  }
  const next = new Map<string, Download>()
  // Historical URLs only redirect to identical GitHub assets (or return 410).
  // They never retain payloads or issue R2 operations.
  for (const item of catalog) {
    next.set(item.key, keep.has(item.key)
      ? { key: item.key, size: item.size, sha256: item.sha256, ...(item.static ? { static: true } : {}), ...(item.fallback ? { fallback: item.fallback } : {}) }
      : { key: item.key, size: item.size, sha256: item.sha256, retired: true, ...(item.fallback ? { fallback: item.fallback } : {}) })
  }
  for (const key of keep) {
    const item = next.get(key)!
    const parts = key.split('/')
    parts[2] = 'latest'
    next.set(parts.join('/'), { ...item, key: parts.join('/'), objectKey: key })
  }
  return [...next.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export function prunePlan<T extends SizedObject>(inventory: T[], catalog: Download[], policy: Retention): T[] {
  const keep = retainedKeys(policy), known = new Map(catalog.map(x => [x.key, x]))
  const live = new Map(inventory.map(x => [x.key, x]))
  if (live.size !== inventory.length) throw new Error('Duplicate inventory keys')
  for (const key of keep) {
    const actual = live.get(key), expected = known.get(key)
    if (!actual || !expected || actual.size !== expected.size) throw new Error('Current release missing or changed: ' + key)
  }
  for (const item of inventory) {
    if (!known.has(item.key)) throw new Error('Uncatalogued object; stop rather than deleting a concurrent upload: ' + item.key)
  }
  return inventory.filter(item => !keep.has(item.key))
}
