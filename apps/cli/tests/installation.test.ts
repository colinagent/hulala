import { expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Installation, installedDirectory, launcherInstallation, readInstallation, withInstallationLock } from '../src/distribution/install.js'
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
    await installation.activate(first); await installation.installLauncher(command, first)
    expect(await launcherInstallation(command)).toBe(location)
    await expect(installation.stage(next, async () => { throw new Error('candidate startup failed') })).rejects.toThrow('startup failed')
    expect((await readInstallation(location)).current.id).toBe(first.id)
    expect((await readdir(join(location, 'versions'))).filter(name => name.startsWith('.staging-'))).toEqual([])
    const second = await installation.stage(next, valid)
    await installation.activate(second); await installation.installLauncher(command, second)
    expect((await readInstallation(location)).previous?.id).toBe(first.id)
    expect(await readFile(command, 'utf8')).toStartWith('1.0.0:')
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

test('installation refuses to overwrite another command or remove a replaced launcher', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala install ownership '))
  try {
    const source = await fixture(root, '1.0.0'), location = join(root, 'install'), command = join(root, 'bin/hulala')
    const install = new Installation(location, join(root, 'state')), first = await install.stage(source, async () => {})
    await mkdir(dirname(command)); await writeFile(command, 'unrelated program')
    await expect(install.installLauncher(command, first)).rejects.toThrow('occupied')
    expect(await readFile(command, 'utf8')).toBe('unrelated program')
    await rm(command); await install.installLauncher(command, first); await install.activate(first)
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
