import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendPathEntry, bundledRipgrep, ripgrepExecutable, ripgrepPathEntry } from '@hulala/editor-home'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), label))
  roots.push(root)
  return root
}

/** Write the platform package that a release installs beside the Host. */
function shippedBinary(nodeModules: string, platform: NodeJS.Platform, arch: string): string {
  const directory = join(nodeModules, '@vscode', `ripgrep-${platform}-${arch}`, 'bin')
  mkdirSync(directory, { recursive: true })
  const binary = join(directory, ripgrepExecutable(platform))
  writeFileSync(binary, 'ripgrep-binary', { mode: 0o755 })
  return binary
}

test('a packaged client resolves the ripgrep binary it ships', () => {
  const root = temporaryRoot('hulala-ripgrep-')
  const packaged = shippedBinary(join(root, 'package', 'runtime', 'node_modules'), 'darwin', 'arm64')
  expect(bundledRipgrep({ packageRoot: join(root, 'package'), platform: 'darwin', arch: 'arm64' })).toBe(packaged)
})

test('a packaged client never falls back to a checkout above it', () => {
  const root = temporaryRoot('hulala-ripgrep-')
  shippedBinary(join(root, 'node_modules'), 'linux', 'x64')
  expect(bundledRipgrep({ packageRoot: join(root, 'package'), platform: 'linux', arch: 'x64' })).toBeUndefined()
})

test('a source checkout resolves the hoisted workspace package', () => {
  const root = temporaryRoot('hulala-ripgrep-')
  const hoisted = shippedBinary(join(root, 'node_modules'), 'linux', 'arm64')
  expect(bundledRipgrep({ repositoryRoot: root, platform: 'linux', arch: 'arm64' })).toBe(hoisted)
})

test('an architecture without a shipped binary resolves nothing', () => {
  const root = temporaryRoot('hulala-ripgrep-')
  shippedBinary(join(root, 'package', 'runtime', 'node_modules'), 'darwin', 'arm64')
  expect(bundledRipgrep({ packageRoot: join(root, 'package'), platform: 'linux', arch: 'x64' })).toBeUndefined()
})

test('the published copy wins over the package it came from', () => {
  const root = temporaryRoot('hulala-ripgrep-')
  const dataRoot = join(root, 'state')
  mkdirSync(join(dataRoot, 'bin'), { recursive: true })
  writeFileSync(join(dataRoot, 'bin', 'rg'), 'published', { mode: 0o755 })
  const packaged = shippedBinary(join(root, 'package', 'runtime', 'node_modules'), process.platform, process.arch)
  expect(ripgrepPathEntry(dataRoot, { packageRoot: join(root, 'package') })).toBe(join(dataRoot, 'bin'))
  expect(ripgrepPathEntry(dataRoot, { packageRoot: undefined, repositoryRoot: join(root, 'package') })).toBe(join(dataRoot, 'bin'))
  expect(packaged).toContain('ripgrep-')
})

test('before anything is published the package directory is the PATH entry', () => {
  const root = temporaryRoot('hulala-ripgrep-')
  const packaged = shippedBinary(join(root, 'package', 'runtime', 'node_modules'), process.platform, process.arch)
  expect(ripgrepPathEntry(join(root, 'state'), { packageRoot: join(root, 'package') })).toBe(join(packaged, '..'))
})

test('without any shipped binary there is no PATH entry to add', () => {
  const root = temporaryRoot('hulala-ripgrep-')
  expect(ripgrepPathEntry(join(root, 'state'), { packageRoot: join(root, 'package') })).toBeUndefined()
})

test('the PATH entry is appended once, never prepended, and keeps the user first', () => {
  expect(appendPathEntry('/usr/bin:/bin', '/opt/hulala/bin', 'darwin')).toBe('/usr/bin:/bin:/opt/hulala/bin')
  expect(appendPathEntry('/usr/bin:/opt/hulala/bin', '/opt/hulala/bin', 'darwin')).toBe('/usr/bin:/opt/hulala/bin')
  expect(appendPathEntry('/usr/bin', undefined, 'darwin')).toBe('/usr/bin')
  expect(appendPathEntry(undefined, undefined, 'darwin')).toBeUndefined()
  expect(appendPathEntry(undefined, 'C:\\hulala\\bin', 'win32')).toBe('C:\\hulala\\bin')
  expect(appendPathEntry('C:\\Windows', 'C:\\hulala\\bin', 'win32')).toBe('C:\\Windows;C:\\hulala\\bin')
})
