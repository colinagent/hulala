import { expect, test } from 'bun:test'
import { buildInstallMetadata, type BuiltArchive } from '../scripts/release/installMetadata'

const archives: BuiltArchive[] = [
  { target: 'darwin-arm64', file: 'hulala-1.2.3-darwin-arm64.tar.gz', sha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64) },
  { target: 'linux-x64', file: 'hulala-1.2.3-linux-x64.tar.gz', sha256: 'd'.repeat(64), manifestSha256: 'e'.repeat(64) },
]
const base = 'https://downloads.example.invalid/hulala/web/1.2.3'
const metadata = buildInstallMetadata({
  version: '1.2.3',
  downloadBase: base,
  githubBase: 'https://github.example.invalid/releases/download/hulala-v1.2.3',
  lockFile: 'runtime-package-lock.json',
  lockSha256: '1'.repeat(64),
  archives,
})

test('every case arm carries its archive digest and the shared lock', () => {
  for (const archive of archives) {
    expect(metadata.installScript).toContain(`${archive.target}) archive='${archive.file}' archive_sha='${archive.sha256}'`)
  }
  expect(metadata.installScript).toContain(`runtime_lock_url='${base}/runtime-package-lock.json'`)
  expect(metadata.installScript).toContain(`runtime_lock_sha='${'1'.repeat(64)}'`)
  // The command the installer runs must hand all four values to `hulala install`.
  expect(metadata.installScript).toContain('--runtime-lock-url $runtime_lock_url')
  expect(metadata.installScript).toContain('runtime_pack_url')
  expect(Bun.spawnSync(['sh', '-n', '/dev/stdin'], { stdin: new TextEncoder().encode(metadata.installScript) }).exitCode).toBe(0)
})

test('the release index tells clients where the dependencies come from', () => {
  const index = metadata.index as any
  for (const archive of archives) {
    const asset = index.releases[0].platforms[archive.target]
    expect(asset.url).toBe(`${base}/${archive.file}`)
    expect(asset.runtime.lock).toEqual({ url: `${base}/runtime-package-lock.json`, sha256: '1'.repeat(64) })
    expect(asset.runtime.pack).toBeUndefined()
  }
})

test('the checksum list covers archives and the lock', () => {
  expect(metadata.shasums.split('\n')).toHaveLength(archives.length + 1)
  expect(metadata.shasums).toContain(`${'1'.repeat(64)}  runtime-package-lock.json`)
})
