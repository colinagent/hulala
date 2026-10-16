import { expect, test } from 'bun:test'
import { compareVersions, fetchReleaseIndex, parseReleaseIndex } from '@hulala/distribution/channels'

const asset = { url: 'https://example.com/hulala.tar.gz', sha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64) }
const index = () => ({ format: 1, product: 'hulala', channels: { stable: '1.0.0', preview: '1.1.0-beta.2' }, releases: [
  { version: '1.0.0', dataFormat: 1, platforms: { 'darwin-arm64': { ...asset } } },
  { version: '1.1.0-beta.2', dataFormat: 1, platforms: { 'darwin-arm64': { ...asset } } },
] })
test('release ordering follows numeric prerelease and stable precedence', () => {
  expect(compareVersions('1.0.0', '1.0.0-rc.99')).toBe(1)
  expect(compareVersions('1.0.0-rc.10', '1.0.0-rc.2')).toBe(1)
  expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1)
  expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  for (const invalid of ['01.0.0', '1.0.0-rc.01', '1.0.0-..', 'latest']) expect(() => compareVersions(invalid, '1.0.0')).toThrow()
})
test('channel manifests reject ambiguous versions, unpinned assets and unsupported targets', () => {
  expect(parseReleaseIndex(index()).channels.stable).toBe('1.0.0')
  const unstable = index(); unstable.channels.stable = '1.1.0-beta.2'
  expect(() => parseReleaseIndex(unstable)).toThrow('channel')
  const duplicate = index(); duplicate.releases.push(duplicate.releases[0]!)
  expect(() => parseReleaseIndex(duplicate)).toThrow('record')
  const wrong = index(); wrong.releases[0]!.platforms['darwin-arm64'].sha256 = ''
  expect(() => parseReleaseIndex(wrong)).toThrow('asset')
  const unsupported = index(); (unsupported.releases[0]!.platforms as any).constructor = asset
  expect(() => parseReleaseIndex(unsupported)).toThrow('asset')
})
test('release checks use a bounded explicit local mirror without selecting prereleases by default', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json(index()) })
  try { expect((await fetchReleaseIndex(`http://127.0.0.1:${server.port}/index`)).channels).toEqual({ stable: '1.0.0', preview: '1.1.0-beta.2' }) }
  finally { server.stop(true) }
})
