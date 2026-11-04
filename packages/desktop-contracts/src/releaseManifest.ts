export type DesktopReleaseAsset = {
  url: string
  sha256: string
  size: number
}

export type DesktopReleaseManifest = {
  version: string
  publishedAt: string
  githubReleaseUrl: string
  signing: {
    macos: 'unsigned' | 'developer-id'
    windows: 'unsigned' | 'authenticode'
  }
  assets: {
    dmg: DesktopReleaseAsset
    zip: DesktopReleaseAsset
    windowsInstaller: DesktopReleaseAsset
    windowsBlockmap: DesktopReleaseAsset
    latestMacYml: DesktopReleaseAsset
    latestYml: DesktopReleaseAsset
  }
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function requiredUrl(value: unknown, label: string): string {
  const url = requiredString(value, label)
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error(`${label} must use https`)
  if (label.startsWith('manifest.assets.') && (
    !['download.op-agent.com', 'downloads.hulala.ai'].includes(parsed.hostname)
    || !parsed.pathname.startsWith('/hulala/desktop/')
  )) throw new Error(`${label} must use the Hulala desktop download namespace`)
  return url
}

function asset(value: unknown, label: string): DesktopReleaseAsset {
  const record = requiredRecord(value, label)
  const size = record.size
  const sha256 = requiredString(record.sha256, `${label}.sha256`)
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error(`${label}.sha256 must be a SHA-256 digest`)
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) throw new Error(`${label}.size must be positive`)
  return { url: requiredUrl(record.url, `${label}.url`), sha256: sha256.toLowerCase(), size }
}

export function parseDesktopReleaseManifest(value: unknown): DesktopReleaseManifest {
  const record = requiredRecord(value, 'manifest')
  const signing = requiredRecord(record.signing, 'manifest.signing')
  const assets = requiredRecord(record.assets, 'manifest.assets')
  const macos = requiredString(signing.macos, 'manifest.signing.macos')
  const windows = requiredString(signing.windows, 'manifest.signing.windows')
  if (macos !== 'unsigned' && macos !== 'developer-id') throw new Error('unsupported macOS signing state')
  if (windows !== 'unsigned' && windows !== 'authenticode') throw new Error('unsupported Windows signing state')
  return {
    version: requiredString(record.version, 'manifest.version'),
    publishedAt: requiredString(record.publishedAt, 'manifest.publishedAt'),
    githubReleaseUrl: requiredUrl(record.githubReleaseUrl, 'manifest.githubReleaseUrl'),
    signing: { macos, windows },
    assets: {
      dmg: asset(assets.dmg, 'manifest.assets.dmg'),
      zip: asset(assets.zip, 'manifest.assets.zip'),
      windowsInstaller: asset(assets.windowsInstaller, 'manifest.assets.windowsInstaller'),
      windowsBlockmap: asset(assets.windowsBlockmap, 'manifest.assets.windowsBlockmap'),
      latestMacYml: asset(assets.latestMacYml, 'manifest.assets.latestMacYml'),
      latestYml: asset(assets.latestYml, 'manifest.assets.latestYml'),
    },
  }
}
