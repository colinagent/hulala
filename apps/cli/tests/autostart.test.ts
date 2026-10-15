import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { getAutostartStatus, installAutostart, macosLaunchAgent, systemdUnit, uninstallAutostart, windowsInstallScript, type CommandRunner } from '../src/autostart.js'
import { resolvePaths } from '../src/paths.js'
import { addCommandPath, removeCommandPath } from '../src/distribution/path.js'
import { applyAutostartEnvironment } from '../src/autostart-environment.js'

const command = { executable: '/Users/example/Hulala & tools/hulala', args: [] }

test('login jobs use stable native commands, limited user permissions and successful-stop semantics', () => {
  const mac = macosLaunchAgent(command, '/Users/example/state/job.json', '/Users/example/log.txt', 'ai.hulala.browser.test')
  expect(mac).toContain('Hulala &amp; tools')
  expect(mac).toContain('<key>SuccessfulExit</key><false/>')
  expect(mac).toContain('__autostart')
  expect(mac).not.toContain('__watchdog')
  const linux = systemdUnit({ executable: '/home/example/100% Hulala/hulala', args: [] }, '/home/example/state/job.json')
  expect(linux).toContain('100%% Hulala')
  expect(linux).toContain('Restart=on-failure')
  expect(windowsInstallScript()).toContain('-LogonType Interactive -RunLevel Limited')
  expect(windowsInstallScript()).not.toMatch(/Highest|SYSTEM|RunAs/)
})

test.skipIf(process.platform === 'win32')('registers and removes only a namespaced current-user login job without installing packages', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hulala login job ')), paths = resolvePaths('darwin', {}, home)
  const calls: string[][] = []
  const runner: CommandRunner = async (command, args) => { calls.push([command, ...args]); return { code: 0, stdout: '', stderr: '' } }
  try {
    const result = await installAutostart(paths, runner, 'darwin', command)
    expect(result.installed).toBe(true)
    expect(calls.some(call => call[0] === 'launchctl' && call[1] === 'bootstrap')).toBe(true)
    expect(calls.some(call => ['npm', 'sudo'].includes(call[0]!))).toBe(false)
    expect(paths.autostartName).toStartWith('ai.hulala.browser.')
    const job = JSON.parse(await readFile(paths.autostartConfig, 'utf8'))
    expect(job.environment.HULALA_HOME).toBe(paths.data)
    expect(Object.keys(job.environment).every(key => ['HULALA_HOME', 'HULALA_WORKSPACE_ROOT', 'HULALA_PORT', 'HULALA_WORKBENCH_PORT', 'HULALA_REMOTE_PACKAGES', 'PATH'].includes(key))).toBe(true)
    await installAutostart(paths, runner, 'darwin', command)
    await uninstallAutostart(paths, runner, 'darwin')
    expect((await getAutostartStatus(paths, runner, 'darwin')).installed).toBe(false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test.skipIf(process.platform === 'win32')('PATH registration preserves user profile contents and symlinks and only removes its exact block', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hulala path ')), target = join(home, 'dotfiles/profile'), bin = join(home, "中文 tools'bin")
  try {
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, 'export USER_PREF=keep\n')
    await symlink(target, join(home, '.zprofile'))
    const registered = await addCommandPath(bin, home, '/bin/zsh', 'darwin')
    expect(registered?.kind).toBe('profile')
    expect(await readFile(target, 'utf8')).toContain('export USER_PREF=keep')
    expect(await readFile(target, 'utf8')).toContain("'\\''")
    await addCommandPath(bin, home, '/bin/zsh', 'darwin')
    expect((await readFile(target, 'utf8')).match(/# >>> hulala/g)).toHaveLength(1)
    await removeCommandPath(registered!)
    expect(await readFile(target, 'utf8')).toBe('export USER_PREF=keep\n')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('login environment refuses provider credentials instead of persisting them as launch options', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hulala job environment '))
  try {
    const file = join(home, 'job.json')
    await writeFile(file, JSON.stringify({ format: 1, product: 'hulala-autostart', environment: { PROVIDER_API_KEY: 'synthetic' } }))
    await expect(applyAutostartEnvironment(['__autostart', file])).rejects.toThrow('environment')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test.skipIf(process.platform === 'win32')('a rejected login registration removes its incomplete configuration', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hulala rejected login ')), paths = resolvePaths('darwin', {}, home)
  const runner: CommandRunner = async () => ({ code: 1, stdout: '', stderr: 'synthetic denied registration' })
  try {
    await expect(installAutostart(paths, runner, 'darwin', command)).rejects.toThrow('denied registration')
    expect(await Bun.file(paths.autostartConfig).exists()).toBe(false)
    expect(await Bun.file(paths.autostartFile!).exists()).toBe(false)
  } finally { await rm(home, { recursive: true, force: true }) }
})
