import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { pack } from 'tar-stream'
import { fileSha256 } from '@hulala/distribution/archive'
import { packageFiles, type PackageManifest } from '@hulala/distribution/manifest'
import { RELEASE_TARGETS, releaseTarget } from '@hulala/distribution/targets'
import { runDistributionCommand } from '../src/distribution/commands.js'
import { installationReceipt, readInstallation } from '../src/distribution/install.js'
import type { HulalaPaths } from '../src/paths.js'
import {
  checkForUpdate,
  latestRelease,
  releaseAvailable,
  UPDATE_CACHE_TTL_MS,
} from '../src/update/check.js'
import { t } from '../src/tui/i18n/index.js'
import { releaseArchivePath, writeReleaseSidecar } from '../src/distribution/releaseCache.js'
import { packageManagerUpdate } from '../src/update/packageManager.js'

const asset = { url: 'https://example.com/hulala.tar.gz', sha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64) }
const platforms = () => Object.fromEntries(Object.keys(RELEASE_TARGETS).map(target => [target, asset]))
const index = (stable = '0.2.0', preview = '0.3.0-beta.1') => ({
  format: 1,
  product: 'hulala',
  channels: { stable, preview },
  releases: [
    { version: stable, dataFormat: 1, platforms: platforms() },
    { version: preview, dataFormat: 1, platforms: platforms() },
  ],
})

const cleanups: Array<() => Promise<void> | void> = []
const savedEnv = new Map<string, string | undefined>()
const ENV_KEYS = ['HOME', 'HULALA_HOME', 'HULALA_INSTALL_ROOT', 'HULALA_INSTALL_SOURCE', 'HULALA_PACKAGE_ROOT', 'HULALA_RELEASE_INDEX_URL'] as const
for (const key of ENV_KEYS) savedEnv.set(key, process.env[key])

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

async function stateRoot(): Promise<HulalaPaths> {
  const root = await mkdtemp(join(tmpdir(), 'hulala update check '))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return { data: root, logs: join(root, 'logs'), launcherLog: join(root, 'logs/host.log') }
}

function mirror(body: () => unknown): { url: string; requests: () => number } {
  let count = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => {
      count += 1
      return Response.json(body())
    },
  })
  cleanups.push(() => server.stop(true))
  return { url: `http://127.0.0.1:${server.port}/web-releases.json`, requests: () => count }
}

test('a newer release is reported and cached for the next startup', async () => {
  const paths = await stateRoot()
  const source = mirror(() => index())
  const env = { HULALA_RELEASE_INDEX_URL: source.url }

  const first = await checkForUpdate({ currentVersion: '0.1.8', paths, env, now: 1_000 })
  expect(first).toEqual({ currentVersion: '0.1.8', latestVersion: '0.2.0' })
  expect(t('update.available', { current: first!.currentVersion, latest: first!.latestVersion })).toContain('0.1.8 → 0.2.0')
  expect(t('update.available', { current: first!.currentVersion, latest: first!.latestVersion })).toContain('/update')

  const cached = await checkForUpdate({ currentVersion: '0.1.8', paths, env, now: 2_000 })
  expect(cached).toEqual(first)
  expect(source.requests()).toBe(1)

  await checkForUpdate({ currentVersion: '0.1.8', paths, env, now: 1_000 + UPDATE_CACHE_TTL_MS })
  expect(source.requests()).toBe(2)
})

test('the stable release is used, and a prerelease build is offered the final version', async () => {
  const paths = await stateRoot()
  const source = mirror(() => index('0.3.0', '0.4.0-beta.1'))
  const env = { HULALA_RELEASE_INDEX_URL: source.url }

  expect(await checkForUpdate({ currentVersion: '0.3.0', paths, env, now: 1_000 })).toBeUndefined()
  expect(source.requests()).toBe(1)

  // The preview channel is not a release line: the beta build is offered the
  // stable 0.3.0, not the newer 0.4.0-beta.1.
  expect(await checkForUpdate({ currentVersion: '0.3.0-beta.2', paths, env, now: 1_000 })).toEqual({
    currentVersion: '0.3.0-beta.2',
    latestVersion: '0.3.0',
  })
  expect(await latestRelease(env)).toBe('0.3.0')
})

test('a release without an archive for this machine is not offered', async () => {
  const paths = await stateRoot()
  const source = mirror(() => {
    const value = index()
    for (const release of value.releases) delete release.platforms[releaseTarget()]
    return value
  })
  expect(await checkForUpdate({
    currentVersion: '0.1.8',
    paths,
    env: { HULALA_RELEASE_INDEX_URL: source.url },
    now: 1_000,
  })).toBeUndefined()
  expect(await latestRelease({ HULALA_RELEASE_INDEX_URL: source.url })).toBeUndefined()
  // `--check --version` must not advertise a release this machine cannot install.
  expect(await releaseAvailable('0.2.0', { HULALA_RELEASE_INDEX_URL: source.url })).toBe(false)
  expect(await releaseAvailable('0.2.0', { HULALA_RELEASE_INDEX_URL: mirror(() => index()).url })).toBe(true)
})

test('offline and opt-out flags skip the network entirely', async () => {
  const paths = await stateRoot()
  const source = mirror(() => index())
  for (const env of [
    { HULALA_RELEASE_INDEX_URL: source.url, HULALA_OFFLINE: '1' },
    { HULALA_RELEASE_INDEX_URL: source.url, HULALA_SKIP_UPDATE_CHECK: '1' },
    { HULALA_RELEASE_INDEX_URL: source.url, NO_UPDATE_NOTIFIER: '1' },
  ]) {
    expect(await checkForUpdate({ currentVersion: '0.1.8', paths, env, now: 1_000 })).toBeUndefined()
  }
  expect(source.requests()).toBe(0)
  expect(await checkForUpdate({
    currentVersion: '0.1.8',
    paths,
    env: { HULALA_RELEASE_INDEX_URL: source.url, HULALA_OFFLINE: '0' },
    now: 1_000,
  })).not.toBeUndefined()
})

test('an unavailable or invalid index never fails the client', async () => {
  const paths = await stateRoot()
  const invalid = mirror(() => ({ format: 1, product: 'hulala', channels: { stable: 'not-a-version' }, releases: [] }))
  expect(await checkForUpdate({
    currentVersion: '0.1.8',
    paths,
    env: { HULALA_RELEASE_INDEX_URL: invalid.url },
    now: 1_000,
  })).toBeUndefined()
  expect(await checkForUpdate({
    currentVersion: '0.1.8',
    paths,
    env: { HULALA_RELEASE_INDEX_URL: 'http://127.0.0.1:1/web-releases.json' },
    now: 1_000,
  })).toBeUndefined()
})

test('package-manager updates pin the release and leave lifecycle scripts off', () => {
  const npm = packageManagerUpdate('npm', '0.2.0')
  expect(npm.args).toEqual(['install', '-g', '--ignore-scripts', 'hulala@0.2.0'])
  expect(npm.display.endsWith('hulala@0.2.0')).toBe(true)

  expect(packageManagerUpdate('bun', '0.2.0').args).toEqual(['install', '-g', '--ignore-scripts', 'hulala@0.2.0'])
  expect(packageManagerUpdate('pnpm', '0.2.0').args).toEqual(['add', '-g', '--ignore-scripts', 'hulala@0.2.0'])
  expect(() => packageManagerUpdate('npm', 'latest')).toThrow('invalid')
})

/** A release package whose executable reports its own version. */
async function releasePackage(root: string, version: string): Promise<string> {
  const directory = join(root, 'package-' + version)
  await mkdir(join(directory, 'bin'), { recursive: true })
  const executable = join(directory, 'bin', 'hulala')
  await writeFile(executable, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(version)})\n`)
  await chmod(executable, 0o755)
  await writeFile(join(directory, 'bin', 'nvim'), 'editor binary')
  for (const file of ['server/hulala-host.mjs', 'runtime/host.mjs', 'runtime/package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    await mkdir(join(directory, file, '..'), { recursive: true })
    await writeFile(join(directory, file), 'fixture ' + file)
  }
  const manifest: PackageManifest = {
    format: 1,
    product: 'hulala',
    stage: 'workbench',
    version,
    target: `${process.platform}-${process.arch}`,
    protocol: 1,
    dataFormat: 1,
    lockSha256: '0'.repeat(64),
    entrypoint: 'bin/hulala',
    files: await packageFiles(directory),
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
  return directory
}

async function archivePackage(directory: string, archive: string): Promise<void> {
  const writer = pack(), writing = pipeline(writer, createGzip(), createWriteStream(archive))
  for (const file of await packageFiles(directory)) {
    writer.entry({ name: 'hulala/' + file.path, mode: file.mode ?? 0o644, type: 'file' }, await readFile(join(directory, file.path)))
  }
  writer.entry({ name: 'hulala/manifest.json', mode: 0o644, type: 'file' }, await readFile(join(directory, 'manifest.json')))
  writer.finalize()
  await writing
}

test('hulala update replaces the installed version, keeps the previous one and rolls back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala update install '))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const state = join(root, 'state'), installRoot = join(state, 'runtime/client'), binDir = join(root, 'bin')
  process.env.HULALA_HOME = state
  process.env.HULALA_INSTALL_ROOT = installRoot
  process.env.HULALA_INSTALL_SOURCE = 'standalone'
  // Shell profile registration must never reach the developer's own home.
  process.env.HOME = root
  delete process.env.HULALA_PACKAGE_ROOT

  const first = await releasePackage(root, '1.0.0')
  expect(await runDistributionCommand('install', ['--from', first, '--root', installRoot, '--bin', binDir, '--no-add-to-path'])).toBe(0)
  expect((await readInstallation(installRoot)).current.version).toBe('1.0.0')

  const second = await releasePackage(root, '2.0.0')
  const archive = join(root, 'hulala-2.0.0.tar.gz')
  await archivePackage(second, archive)
  const bytes = await readFile(archive)
  const manifestSha256 = await fileSha256(join(second, 'manifest.json'))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  let origin = ''
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path === '/archive.tar.gz') return new Response(bytes)
      if (path !== '/web-releases.json') return new Response('not found', { status: 404 })
      return Response.json({
        format: 1,
        product: 'hulala',
        channels: { stable: '2.0.0' },
        releases: [{
          version: '2.0.0',
          dataFormat: 1,
          platforms: Object.fromEntries(Object.keys(RELEASE_TARGETS).map(target => [target, {
            url: `${origin}/archive.tar.gz`,
            sha256,
            manifestSha256,
          }])),
        }],
      })
    },
  })
  cleanups.push(() => server.stop(true))
  origin = `http://127.0.0.1:${server.port}`
  process.env.HULALA_RELEASE_INDEX_URL = `${origin}/web-releases.json`

  expect(await runDistributionCommand('update', ['--no-add-to-path'])).toBe(0)
  const active = await readInstallation(installRoot)
  expect(active.current.version).toBe('2.0.0')
  expect(active.previous?.version).toBe('1.0.0')

  // The launcher the installer wrote still resolves the active version, so an
  // update is picked up without rewriting a baked-in package path.
  const receipt = await installationReceipt(installRoot)
  expect(receipt.command).toBe(join(await realpath(binDir), 'hulala'))
  const launched = Bun.spawnSync([receipt.command], { stdout: 'pipe', stderr: 'pipe' })
  expect(launched.exitCode).toBe(0)
  expect(launched.stdout.toString().trim()).toBe('2.0.0')

  expect(await runDistributionCommand('rollback', [])).toBe(0)
  expect((await readInstallation(installRoot)).current.version).toBe('1.0.0')
})

test('a release that is already downloaded is announced as ready to install', async () => {
  const paths = await stateRoot()
  const source = mirror(() => index())
  const env = { HULALA_RELEASE_INDEX_URL: source.url }

  // Nothing downloaded yet: the reminder names the in-client command.
  const available = await checkForUpdate({ currentVersion: '0.1.8', paths, env, now: 1_000 })
  expect(available?.downloaded).toBeUndefined()
  expect(t('update.available', { current: available!.currentVersion, latest: available!.latestVersion })).toContain('/update')

  // `hulala update --background` leaves the archive next to its index facts.
  const archive = releaseArchivePath(paths.data, '0.2.0')
  await mkdir(join(paths.data, 'cache', 'releases', '0.2.0'), { recursive: true })
  await writeFile(archive, 'downloaded')
  await writeReleaseSidecar(archive, { sha256: 'a'.repeat(64), dataFormat: 1, manifestSha256: 'b'.repeat(64) })

  const ready = await checkForUpdate({ currentVersion: '0.1.8', paths, env, now: 2_000 })
  expect(ready).toEqual({ currentVersion: '0.1.8', latestVersion: '0.2.0', downloaded: true })
  expect(t('update.downloaded', { version: ready!.latestVersion })).toContain('/update')
})

test('hulala update downloads when nothing is cached, reuses a prefetched release and prunes the cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala update cache '))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const state = join(root, 'state'), installRoot = join(state, 'runtime/client'), binDir = join(root, 'bin')
  process.env.HULALA_HOME = state
  process.env.HULALA_INSTALL_ROOT = installRoot
  process.env.HULALA_INSTALL_SOURCE = 'standalone'
  process.env.HOME = root
  delete process.env.HULALA_PACKAGE_ROOT

  const first = await releasePackage(root, '1.0.0')
  expect(await runDistributionCommand('install', ['--from', first, '--root', installRoot, '--bin', binDir, '--no-add-to-path'])).toBe(0)

  const second = await releasePackage(root, '2.0.0')
  const archive = join(root, 'hulala-2.0.0.tar.gz')
  await archivePackage(second, archive)
  const bytes = await readFile(archive)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const manifestSha256 = await fileSha256(join(second, 'manifest.json'))
  let archiveRequests = 0
  let origin = ''
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path === '/archive.tar.gz') { archiveRequests += 1; return new Response(bytes) }
      if (path !== '/web-releases.json') return new Response('not found', { status: 404 })
      return Response.json({
        format: 1,
        product: 'hulala',
        channels: { stable: '2.0.0' },
        releases: [{
          version: '2.0.0',
          dataFormat: 1,
          platforms: Object.fromEntries(Object.keys(RELEASE_TARGETS).map(target => [target, {
            url: `${origin}/archive.tar.gz`,
            sha256,
            manifestSha256,
          }])),
        }],
      })
    },
  })
  cleanups.push(() => server.stop(true))
  origin = `http://127.0.0.1:${server.port}`
  process.env.HULALA_RELEASE_INDEX_URL = `${origin}/web-releases.json`

  // An older package may still sit in the cache from an earlier prefetch.
  const stale = join(state, 'cache', 'releases', '0.9.0')
  await mkdir(stale, { recursive: true })

  // 1. Nothing cached yet: `update` checks the index and downloads it.
  expect(await runDistributionCommand('update', ['--no-add-to-path'])).toBe(0)
  expect((await readInstallation(installRoot)).current.version).toBe('2.0.0')
  expect(archiveRequests).toBe(1)
  const cache = await readdir(join(state, 'cache', 'releases'))
  expect(cache).toEqual(['2.0.0'])

  // 2. A prefetch installs without touching the archive endpoint again.
  await rm(join(state, 'cache', 'releases', '2.0.0'), { recursive: true, force: true })
  expect(await runDistributionCommand('update', ['--download-only', '--version', '2.0.0'])).toBe(0)
  expect((await readInstallation(installRoot)).current.version).toBe('2.0.0')
  expect(archiveRequests).toBe(2)
  expect(await readdir(join(state, 'cache', 'releases'))).toEqual(['2.0.0'])
})
