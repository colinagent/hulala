import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, win32 } from 'node:path'
import test from 'node:test'

import { browserLaunch } from '../src/browser.ts'
import { probeHealth } from '../src/health.ts'
import { resolvePaths } from '../src/paths.ts'
import { authorizeLocalRequest, authorizeServiceAction } from '../src/launcher.ts'
import { APP_AUTHORITY, APP_HOST, APP_PORT, APP_URL, HEALTH_URL, VERSION } from '../src/constants.ts'
import { recoveryPage } from '../src/recovery-page.ts'
import { WorkbenchController } from '../src/workbench.ts'

test('uses native browser launchers without a shell', () => {
  assert.deepEqual(browserLaunch('http://127.0.0.1:3210/', 'darwin'), {
    command: 'open', args: ['http://127.0.0.1:3210/'],
  })
  assert.deepEqual(browserLaunch('http://127.0.0.1:3210/', 'win32'), {
    command: win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe'), args: ['url.dll,FileProtocolHandler', 'http://127.0.0.1:3210/'],
  })
  assert.deepEqual(browserLaunch('http://hulala.localhost:3210/', 'win32', 'C:\\Program Files\\Browser\\browser.exe'), {
    command: 'C:\\Program Files\\Browser\\browser.exe', args: ['http://hulala.localhost:3210/'],
  })
  assert.throws(() => browserLaunch('http://hulala.localhost:3210/', 'linux', 'browser --shell-argument'), /absolute executable/)
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
  assert.equal(resolvePaths('darwin', {}, '/Users/test').launcherLog, '/Users/test/.config/hulala/logs/launcher.log')
  assert.equal(resolvePaths('win32', { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' }, 'C:\\Users\\test').launcherLog,
    'C:\\Users\\test\\.config\\hulala\\logs\\launcher.log')
  assert.equal(resolvePaths('linux', { HULALA_HOME: '/tmp/hulala-test-state' }, '/unused').autostartConfig,
    '/tmp/hulala-test-state/runtime/launcher/autostart.json')
  assert.throws(() => resolvePaths('darwin', { HULALA_HOME: 'relative' }, '/unused'), /absolute path/)
})

test('requires a same-origin process token for service actions', () => {
  const request = (headers: IncomingMessage['headers']) => ({ headers }) as IncomingMessage
  assert.equal(authorizeServiceAction(request({
    host: APP_AUTHORITY,
    origin: new URL(APP_URL).origin,
    'content-type': 'application/json',
    'x-hulala-token': 'secret',
  }), 'secret'), undefined)
  assert.equal(authorizeServiceAction(request({
    host: APP_AUTHORITY,
    origin: 'https://example.com',
    'content-type': 'application/json',
    'x-hulala-token': 'secret',
  }), 'secret'), 'origin rejected')
  assert.equal(authorizeServiceAction(request({
    host: APP_AUTHORITY,
    origin: new URL(APP_URL).origin,
    'content-type': 'application/json',
    'x-hulala-token': 'wrong',
  }), 'secret'), 'invalid action token')
})

test('uses hulala.localhost in the browser and numeric loopback for CLI health', () => {
  assert.equal(APP_URL, new URL(`http://hulala.localhost:${APP_PORT}/`).href)
  assert.equal(APP_HOST, '127.0.0.1')
  assert.equal(HEALTH_URL, `http://127.0.0.1:${APP_PORT}/api/hulala/health`)
})

test('checks browser and websocket host and origin without trusting forwarded headers', () => {
  const request = (headers: IncomingMessage['headers']) => ({ headers }) as IncomingMessage
  for (const host of [APP_AUTHORITY, new URL(HEALTH_URL).host]) {
    assert.equal(authorizeLocalRequest(request({ host, origin: `http://${host}` })), undefined)
    assert.equal(authorizeLocalRequest(request({ host })), undefined)
    assert.equal(authorizeLocalRequest(request({ host, origin: 'null' })), 'origin rejected')
    assert.equal(authorizeLocalRequest(request({ host, origin: `http://${host}`, 'sec-fetch-site': 'cross-site' })), 'cross-site request rejected')
  }
  for (const host of [undefined, 'evil.example', `hulala.localhost.evil.example:${APP_PORT}`, `other.localhost:${APP_PORT}`]) {
    assert.equal(authorizeLocalRequest(request({ host, 'x-forwarded-host': APP_AUTHORITY })), 'host rejected')
  }
  assert.equal(authorizeLocalRequest(request({ host: APP_AUTHORITY, origin: `http://${APP_HOST}:${APP_PORT}` })), 'origin rejected')
  assert.equal(authorizeServiceAction(request({
    host: new URL(HEALTH_URL).host,
    origin: new URL(HEALTH_URL).origin,
    'content-type': 'application/json',
    'x-hulala-token': 'secret',
  }), 'secret'), undefined)
})

test('keeps local workbench recovery available without advertising unsupported hosted products', () => {
  const html = recoveryPage()
  assert.match(html, /Hulala Local/)
  assert.doesNotMatch(html, /Cloud|local\.hulala\.ai/)
  assert.match(html, /Start workbench/)
})

test('serializes idempotent workbench start, stop, and restart operations', async () => {
  const healthServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ name: 'hulala', version: VERSION, pid: 100 + spawnCount, startedAt: new Date().toISOString() }))
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
