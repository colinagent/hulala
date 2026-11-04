import { describe, test, expect } from 'bun:test'
import { parseDesktopReleaseManifest } from '../src/releaseManifest'

const digest = 'a'.repeat(64)
const releaseAsset = (name: string) => ({ url: `https://download.op-agent.com/hulala/desktop/0.1.0/${name}`, sha256: digest, size: 42 })

describe('Desktop release manifest', () => {
  test('accepts the Cloudflare download domain without trusting lookalike hosts', () => {
    const shape = (origin: string) => ({
      version: '0.1.4', publishedAt: '2026-10-17T00:00:00Z',
      githubReleaseUrl: 'https://github.com/colinagent/hulala/releases/tag/hulala-v0.1.4',
      signing: { macos: 'unsigned', windows: 'unsigned' },
      assets: Object.fromEntries(['dmg', 'zip', 'windowsInstaller', 'windowsBlockmap', 'latestMacYml', 'latestYml'].map(name => [name, {
        url: `${origin}/hulala/desktop/0.1.4/${name}`, sha256: digest, size: 42,
      }])),
    })
    expect(parseDesktopReleaseManifest(shape('https://downloads.hulala.ai')).assets.dmg.url.startsWith('https://downloads.hulala.ai/')).toBe(true)
    expect(() => parseDesktopReleaseManifest(shape('https://downloads.hulala.ai.evil.example'))).toThrow('Hulala desktop download namespace')
  })
  test('accepts the namespaced unsigned release shape', () => {
    const parsed = parseDesktopReleaseManifest({
      version: '0.1.0',
      publishedAt: '2026-08-29T00:00:00Z',
      githubReleaseUrl: 'https://github.com/colinagent/hulala/releases/tag/hulala-v0.1.0',
      signing: { macos: 'unsigned', windows: 'unsigned' },
      assets: {
        dmg: releaseAsset('Hulala-0.1.0-arm64.dmg'),
        zip: releaseAsset('Hulala-0.1.0-arm64-mac.zip'),
        windowsInstaller: releaseAsset('Hulala-Setup-0.1.0.exe'),
        windowsBlockmap: releaseAsset('Hulala-Setup-0.1.0.exe.blockmap'),
        latestMacYml: releaseAsset('latest-mac.yml'),
        latestYml: releaseAsset('latest.yml'),
      },
    })
    expect(parsed.signing).toEqual({ macos: 'unsigned', windows: 'unsigned' })
    expect(parsed.assets.dmg.url).toContain('/hulala/desktop/0.1.0/')
  })

  test('rejects an OpenBrain-colliding asset URL', () => {
    expect(() => parseDesktopReleaseManifest({
      version: '0.1.0', publishedAt: 'now', githubReleaseUrl: 'https://github.com/colinagent/hulala/releases',
      signing: { macos: 'unsigned', windows: 'unsigned' },
      assets: {
        dmg: { ...releaseAsset('app.dmg'), url: 'https://download.op-agent.com/desktop/0.1.0/app.dmg' },
        zip: releaseAsset('app.zip'), windowsInstaller: releaseAsset('app.exe'), windowsBlockmap: releaseAsset('app.blockmap'),
        latestMacYml: releaseAsset('latest-mac.yml'), latestYml: releaseAsset('latest.yml'),
      },
    })).toThrow('Hulala desktop download namespace')
  })
})
