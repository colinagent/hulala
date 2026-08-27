import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { browserLaunch } from '../src/browser.ts'
import { probeHealth } from '../src/health.ts'
import { resolvePaths } from '../src/paths.ts'
import { authorizeServiceAction } from '../src/launcher.ts'
import { recoveryPage } from '../src/recovery-page.ts'
import { WorkbenchController } from '../src/workbench.ts'
import { installAutostart, macosLaunchAgent, uninstallAutostart, windowsInstallScript, type CommandRunner } from '../src/autostart.ts'
import { activateManagedVersion, readActiveManifest, rollbackManagedVersion } from '../src/managed-runtime.ts'
import { applyManagedUpdate, isNewerVersion, validateManagedVersionStartup } from '../src/update.ts'

test('uses native browser launchers without a shell', () => {
  assert.deepEqual(browserLaunch('http://127.0.0.1:3210/', 'darwin'), {
    command: 'open', args: ['http://127.0.0.1:3210/'],
  })
  assert.deepEqual(browserLaunch('http://127.0.0.1:3210/', 'win32'), {
    command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', 'http://127.0.0.1:3210/'],
  })
})

test('recognizes only a Hulala health response', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ name: 'hulala', version: '0.1.0', pid: 42, startedAt: '2026-08-15T00:00:00.000Z' }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  try {
    assert.deepEqual(await probeHealth(`http://127.0.0.1:${address.port}/health`), {
      name: 'hulala', version: '0.1.0', pid: 42, startedAt: '2026-08-15T00:00:00.000Z',
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('uses per-user data and log locations', () => {
  assert.equal(resolvePaths('darwin', {}, '/Users/test').launcherLog, '/Users/test/Library/Logs/Hulala/launcher.log')
  assert.equal(resolvePaths('win32', { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' }, 'C:\\Users\\test').launcherLog,
    'C:\\Users\\test\\AppData\\Local\\Hulala\\logs\\launcher.log')
})

test('requires a same-origin process token for service actions', () => {
  const request = (headers: IncomingMessage['headers']) => ({ headers }) as IncomingMessage
  assert.equal(authorizeServiceAction(request({
    origin: 'http://127.0.0.1:3210',
    'content-type': 'application/json',
    'x-hulala-token': 'secret',
  }), 'secret'), undefined)
  assert.equal(authorizeServiceAction(request({
    origin: 'https://example.com',
    'content-type': 'application/json',
    'x-hulala-token': 'secret',
  }), 'secret'), 'origin rejected')
  assert.equal(authorizeServiceAction(request({
    origin: 'http://127.0.0.1:3210',
    'content-type': 'application/json',
    'x-hulala-token': 'wrong',
  }), 'secret'), 'invalid action token')
})

test('keeps Local recovery and Cloud navigation available while the workbench is stopped', () => {
  const html = recoveryPage()
  assert.match(html, />Local</)
  assert.match(html, /https:\/\/hulala\.ai\//)
  assert.match(html, /Start workbench/)
})

test('serializes idempotent workbench start, stop, and restart operations', async () => {
  const healthServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ name: 'hulala', version: '0.1.0', pid: 91, startedAt: new Date().toISOString() }))
  })
  await new Promise<void>(resolve => healthServer.listen(0, '127.0.0.1', resolve))
  const address = healthServer.address()
  assert.ok(address !== null && typeof address !== 'string')
  let spawnCount = 0
  let killCount = 0
  const controller = new WorkbenchController(async () => {
    spawnCount += 1
    const child = new EventEmitter() as EventEmitter & { pid: number; kill(signal: NodeJS.Signals): boolean }
    child.pid = 100 + spawnCount
    child.kill = signal => {
      killCount += 1
      queueMicrotask(() => child.emit('exit', 0, signal))
      return true
    }
    return { child: child as any, temporaryDirectory: await mkdtemp(join(tmpdir(), 'hulala-test-')) }
  }, `http://127.0.0.1:${address.port}/health`)
  try {
    await Promise.all([controller.start(), controller.start()])
    assert.equal(spawnCount, 1)
    assert.equal(controller.status().state, 'running')
    await Promise.all([controller.stop(), controller.stop()])
    assert.equal(killCount, 1)
    assert.equal(controller.status().state, 'stopped')
    await controller.restart()
    assert.equal(spawnCount, 2)
    assert.equal(controller.status().state, 'running')
    await controller.stop()
  } finally {
    await new Promise<void>((resolve, reject) => healthServer.close(error => error ? reject(error) : resolve()))
  }
})

test('renders least-privilege macOS and Windows login jobs', () => {
  const plist = macosLaunchAgent('/tmp/Loop & AI/cli.js', '/tmp/Loop & AI/log.txt', '/usr/bin/node')
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/)
  assert.match(plist, /Loop &amp; AI/)
  assert.doesNotMatch(plist, /sudo|root/)
  const powershell = windowsInstallScript()
  assert.match(powershell, /New-ScheduledTaskTrigger -AtLogOn/)
  assert.match(powershell, /RestartCount 3/)
  assert.doesNotMatch(powershell, /Highest|SYSTEM/)
})

test('installs and removes a current-user macOS LaunchAgent idempotently', async () => {
  const userHome = await mkdtemp(join(tmpdir(), 'hulala-autostart-test-'))
  const paths = resolvePaths('darwin', {}, userHome)
  const pinnedEntry = join(paths.versionsRoot, '0.1.0', 'node_modules', 'hulala', 'dist', 'cli.js')
  await mkdir(dirname(pinnedEntry), { recursive: true })
  await writeFile(pinnedEntry, '#!/usr/bin/env node\n', 'utf8')
  const commands: Array<{ command: string; args: string[] }> = []
  const runner: CommandRunner = async (command, args) => {
    commands.push({ command, args })
    return { code: 0, stdout: '', stderr: '' }
  }
  try {
    const installed = await installAutostart(paths, runner, 'darwin')
    assert.equal(installed.installed, true)
    assert.equal(installed.manager, 'launchd')
    assert.ok(commands.some(command => command.command === 'launchctl' && command.args[0] === 'bootstrap'))
    assert.ok(commands.every(command => command.command !== 'sudo'))
    const removed = await uninstallAutostart(paths, runner, 'darwin')
    assert.equal(removed.installed, false)
  } finally {
    await rm(userHome, { recursive: true, force: true })
  }
})

test('compares stable and prerelease update versions', () => {
  assert.equal(isNewerVersion('0.1.1', '0.1.0'), true)
  assert.equal(isNewerVersion('0.1.0', '0.1.0'), false)
  assert.equal(isNewerVersion('0.1.0', '0.1.0-rc.1'), true)
  assert.equal(isNewerVersion('0.1.0-rc.2', '0.1.0-rc.1'), true)
  assert.equal(isNewerVersion('not-a-version', '0.1.0'), false)
})

test('stages updates without switching active code until startup validation passes', async () => {
  const userHome = await mkdtemp(join(tmpdir(), 'hulala-update-test-'))
  const paths = resolvePaths('darwin', {}, userHome)
  await activateManagedVersion({ version: '0.1.0', entry: '/managed/0.1.0/cli.js', installedAt: '2026-08-15T00:00:00.000Z' }, paths)
  const runner: CommandRunner = async (command, args) => {
    if (command === 'npm') {
      const prefix = args[args.indexOf('--prefix') + 1]
      assert.ok(prefix)
      const packageRoot = join(prefix, 'node_modules', 'hulala')
      await mkdir(join(packageRoot, 'dist'), { recursive: true })
      await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: 'hulala', version: '0.2.0' }), 'utf8')
      await writeFile(join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n', 'utf8')
      await writeFile(join(prefix, 'package-lock.json'), JSON.stringify({
        packages: { 'node_modules/hulala': { version: '0.2.0', integrity: 'sha512-dGVzdA==' } },
      }), 'utf8')
      return { code: 0, stdout: '', stderr: '' }
    }
    return { code: 0, stdout: '0.2.0\n', stderr: '' }
  }
  try {
    await assert.rejects(
      applyManagedUpdate('0.2.0', 'hulala@0.2.0', paths, runner, async () => { throw new Error('startup failed') }),
      /startup failed/,
    )
    assert.equal((await readActiveManifest(paths))?.version, '0.1.0')
    const activated = await applyManagedUpdate('0.2.0', 'hulala@0.2.0', paths, runner, async () => undefined)
    assert.equal(activated.version, '0.2.0')
    assert.equal(activated.previous?.version, '0.1.0')
    assert.equal((await rollbackManagedVersion(paths))?.version, '0.1.0')
    assert.ok((await readdir(paths.versionsRoot)).every(name => !name.startsWith('.staging-')))
  } finally {
    await rm(userHome, { recursive: true, force: true })
  }
})

test('removes a failed download staging directory and preserves the active version', async () => {
  const userHome = await mkdtemp(join(tmpdir(), 'hulala-update-failure-test-'))
  const paths = resolvePaths('darwin', {}, userHome)
  await activateManagedVersion({ version: '0.1.0', entry: '/managed/0.1.0/cli.js', installedAt: '2026-08-15T00:00:00.000Z' }, paths)
  try {
    await assert.rejects(
      applyManagedUpdate('0.2.0', 'hulala@0.2.0', paths, async () => ({ code: 1, stdout: '', stderr: 'network unavailable' })),
      /network unavailable/,
    )
    assert.equal((await readActiveManifest(paths))?.version, '0.1.0')
    assert.deepEqual(await readdir(paths.versionsRoot), [])
  } finally {
    await rm(userHome, { recursive: true, force: true })
  }
})

test('validates a candidate with an isolated launcher and workbench health check', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hulala-candidate-test-'))
  const entry = join(directory, 'candidate.mjs')
  await writeFile(entry, `import { createServer } from 'node:http';
const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({name:'hulala',version:'9.9.9',workbench:{state:'running'}}))});
server.listen(Number(process.env.HULALA_PORT),'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
`, 'utf8')
  try {
    await validateManagedVersionStartup({ version: '9.9.9', entry, installedAt: new Date().toISOString() }, 5_000)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
