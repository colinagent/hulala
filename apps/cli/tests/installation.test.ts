import { expect, test } from 'bun:test'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Installation, installedDirectory, launcherRoot, readInstallation, withInstallationLock } from '../src/distribution/install.js'
import { fixture } from './fixtures/package.js'


test('installs immutable versions, validates before activation, rolls back safely and preserves user data on uninstall', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala installation 中文 '))
  const state = join(root, 'state'), location = join(state, 'runtime/install'), command = join(root, 'commands/hulala')
  const installation = new Installation(location, state)
  const valid = async () => {}
  try {
    await mkdir(join(state, 'config'), { recursive: true }); await writeFile(join(state, 'config/user.json'), 'user data')
    const source = await fixture(root, '1.0.0'), next = await fixture(root, '1.1.0')
    const first = await installation.stage(source, valid)
    await installation.activate(first); await installation.installLauncher(command)
    expect(launcherRoot(await readFile(command, 'utf8'))).toBe(location)
    await expect(installation.stage(next, async () => { throw new Error('candidate startup failed') })).rejects.toThrow('startup failed')
    expect((await readInstallation(location)).current.id).toBe(first.id)
    expect((await readdir(join(location, 'versions'))).filter(name => name.startsWith('.staging-'))).toEqual([])
    const second = await installation.stage(next, valid)
    await installation.activate(second); await installation.installLauncher(command)
    expect((await readInstallation(location)).previous?.id).toBe(first.id)
    expect(await readFile(command, 'utf8')).toStartWith('#!/bin/sh')
    await mkdir(join(state, 'server'), { recursive: true }); await writeFile(join(state, 'server/browser-data-format.json'), '{"format":2}')
    await expect(installation.rollback(valid)).rejects.toThrow('current user data format')
    expect((await readInstallation(location)).current.id).toBe(second.id)
    await writeFile(join(state, 'server/browser-data-format.json'), '{"format":1}')
    await installation.rollback(valid)
    expect((await readInstallation(location)).current.id).toBe(first.id)
    await writeFile(join(location, 'versions/notes.txt'), 'unrelated')
    const result = await installation.uninstall()
    expect(result.preserved).toEqual([join(location, 'versions/notes.txt')])
    expect(await readFile(join(state, 'config/user.json'), 'utf8')).toBe('user data')
    expect(await readFile(join(location, 'versions/notes.txt'), 'utf8')).toBe('unrelated')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('installation replaces its own command and refuses one that belongs to another program', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala install ownership '))
  try {
    const source = await fixture(root, '1.0.0'), location = join(root, 'install'), command = join(root, 'bin/hulala')
    const install = new Installation(location, join(root, 'state')), first = await install.stage(source, async () => {})
    // The real command lives in the state root, so an older command there is
    // Hulala's to replace.
    const inside = join(root, 'state/bin/hulala')
    await mkdir(dirname(inside), { recursive: true }); await writeFile(inside, 'leftover program')
    await install.installLauncher(inside); await install.activate(first)
    expect(launcherRoot(await readFile(inside, 'utf8'))).toBe(location)
    // On the user's PATH the command is a symlink to that file.
    await install.installLauncher(command)
    expect((await lstat(command)).isSymbolicLink()).toBe(true)
    expect(await realpath(command)).toBe(await realpath(inside))
    await install.installLauncher(command)
    expect(await realpath(command)).toBe(await realpath(inside))
    // A foreign file or link where the command goes is never replaced.
    await rm(command); await writeFile(command, 'another tool')
    await expect(install.installLauncher(command)).rejects.toThrow('belongs to another program')
    expect(await readFile(command, 'utf8')).toBe('another tool')
    await rm(command); await symlink(join(root, 'unrelated'), command)
    await expect(install.installLauncher(command)).rejects.toThrow('belongs to another program')
    await rm(command); await install.installLauncher(command)
    await writeFile(command, 'user replacement')
    await expect(install.uninstall()).rejects.toThrow('replaced')
    expect(await readFile(command, 'utf8')).toBe('user replacement')
    expect((await readInstallation(location)).current.id).toBe(first.id)
    await expect(new Installation(source, join(root, 'state')).stage(source, async () => {})).rejects.toThrow('outside')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('installation operations serialize and concurrent staging preserves one verified version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala install concurrency '))
  try {
    const source = await fixture(root, '1.0.0'), install = new Installation(join(root, 'install'), join(root, 'state'))
    const versions = await Promise.all([install.stage(source, async () => {}), install.stage(source, async () => {})])
    expect(versions[0]).toEqual(versions[1])
    const order: string[] = []
    await Promise.all([withInstallationLock(install.root, async () => { order.push('start'); await Bun.sleep(20); order.push('end') }), withInstallationLock(install.root, async () => { order.push('second') })])
    expect(order.indexOf('end')).toBe(order.indexOf('start') + 1)
    expect(order).toHaveLength(3)
    expect(await Bun.file(join(installedDirectory(install.root, versions[0]!), 'manifest.json')).exists()).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('pruning keeps the active version, the previous one and a version still running', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala prune '))
  try {
    const install = new Installation(join(root, 'install'), join(root, 'state'))
    const versions = []
    for (const version of ['1.0.0', '2.0.0', '3.0.0']) versions.push(await install.stage(await fixture(root, version), async () => {}))
    await install.activate(versions[0]!)
    await install.activate(versions[1]!)
    const active = await install.activate(versions[2]!)
    expect(active.previous?.id).toBe(versions[1]!.id)

    // 1.0.0 is unreachable: neither active nor previous nor running.
    expect(await install.prune(active)).toEqual([])
    expect((await readdir(join(root, 'install/versions'))).sort()).toEqual([versions[1]!.id, versions[2]!.id].sort())

    // A version another terminal still runs survives the next update.
    const running = await install.stage(await fixture(root, '1.0.0'), async () => {})
    await install.activate(running)
    const activeAgain = await install.activate(versions[2]!)
    expect(activeAgain.previous?.id).toBe(running.id)
    expect(await install.prune(activeAgain, [running.id])).toEqual([])
    expect((await readdir(join(root, 'install/versions'))).sort()).toEqual([running.id, versions[2]!.id].sort())
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('staging repairs a version installed without its runtime tree, and --force replaces a complete one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala install runtime '))
  try {
    const location = join(root, 'install')
    const install = new Installation(location, join(root, 'state'))
    const source = await fixture(root, '1.0.0')
    // The candidate the updater stages has already had its dependency tree
    // installed. `packageFiles` skips that tree, so the manifest digest — and the
    // version id — do not change because of it.
    await mkdir(join(source, 'runtime/node_modules'), { recursive: true })
    await writeFile(join(source, 'runtime/node_modules/.hulala-runtime.json'), '{"source":"npm"}')
    const first = await install.stage(source, async () => {})
    const installed = installedDirectory(location, first)

    // A client from before the dependency lock leaves exactly this: files that
    // verify, and no tree the Host could boot.
    await rm(join(installed, 'runtime/node_modules'), { recursive: true, force: true })
    expect((await install.stage(source, async () => {})).id).toBe(first.id)
    expect(JSON.parse(await readFile(join(installed, 'runtime/node_modules/.hulala-runtime.json'), 'utf8'))).toEqual({ source: 'npm' })

    // A complete tree is not copied again: a second update is a read, not 300 MB
    // of disk work.
    await writeFile(join(installed, 'runtime/node_modules/installed-marker.txt'), 'kept')
    await install.stage(source, async () => {})
    expect(await readFile(join(installed, 'runtime/node_modules/installed-marker.txt'), 'utf8')).toBe('kept')

    // `--force` is the documented "reinstall even when already current".
    await install.stage(source, async () => {}, true)
    await expect(readFile(join(installed, 'runtime/node_modules/installed-marker.txt'), 'utf8')).rejects.toThrow()
    expect((await readdir(join(location, 'versions'))).filter(name => name.includes('.replaced-'))).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})
