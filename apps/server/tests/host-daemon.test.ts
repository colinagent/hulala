import { afterEach, test, expect } from 'bun:test'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConnectionDescriptor } from '@hulala/desktop-contracts'
import { HOST_DAEMON_PROTOCOL, readHostEndpoint, resolveHostDaemonPaths } from '@hulala/desktop-contracts/hostdaemon'
import { resolveHulalaPaths } from '@hulala/desktop-contracts/paths'
import { acquireHostDaemonLock, prepareHostDaemon } from '../src/daemon'
import type { ServerConfig } from '../src/config'

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) server.close()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hulala-host-daemon-'))
  roots.push(root)
  const paths = resolveHulalaPaths(join(root, 'state'), join(root, 'workspace'))
  const daemon = resolveHostDaemonPaths(paths)
  await mkdir(daemon.directory, { recursive: true })
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 0,
    hulalaRoot: paths.root,
    workspaceRoot: paths.workspaceRoot,
    version: '0.1.4',
    daemon: true,
  }
  return { root, paths, daemon, config }
}

function descriptor(httpUrl = 'http://127.0.0.1:1'): ConnectionDescriptor {
  return {
    httpUrl,
    eventsUrl: `${httpUrl.replace('http', 'ws')}/api/desktop/v1/events`,
    token: 'k'.repeat(43),
    instanceId: 'instance-1',
    authCookieName: 'hulala_instance_1',
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

/** A live-but-different pid, used to prove stale locks are reaped. */
async function deadPid(): Promise<number> {
  const child = spawn('true', [], { stdio: 'ignore' })
  const pid = child.pid
  if (pid === undefined) throw new Error('spawned child has no pid')
  await new Promise<void>((resolve) => child.once('exit', () => resolve()))
  return pid
}

test('claims one daemon per state root and reports the running holder', async () => {
  const { daemon, config } = await fixture()
  const first = await prepareHostDaemon(config)
  expect(first.kind).toBe('ready')
  if (first.kind !== 'ready') throw new Error('expected the first start to own the daemon')

  const second = await prepareHostDaemon(config)
  expect(second.kind).toBe('conflict')
  if (second.kind !== 'conflict') throw new Error('expected the second start to be refused')
  expect(second.reason).toContain(String(process.pid))

  await first.lifecycle.dispose()
  expect(await exists(daemon.lock)).toBe(false)
})

test('reaps a lock whose owner died', async () => {
  const { daemon, config } = await fixture()
  await writeFile(daemon.lock, JSON.stringify({ pid: await deadPid(), version: '0.0.1', startedAt: '' }), 'utf8')
  const prepared = await prepareHostDaemon(config)
  expect(prepared.kind).toBe('ready')
  await (prepared as { lifecycle: { dispose(): Promise<void> } }).lifecycle.dispose()
})

test('publishes the authenticated descriptor and withdraws it on dispose', async () => {
  const { paths, daemon, config } = await fixture()
  const prepared = await prepareHostDaemon(config)
  if (prepared.kind !== 'ready') throw new Error('expected the daemon lock')
  const published = descriptor()
  await prepared.lifecycle.publish({
    descriptor: published,
    version: config.version,
    hulalaRoot: paths.root,
    workspaceRoot: paths.workspaceRoot,
  })

  const record = await readHostEndpoint(daemon)
  expect(record?.protocol).toBe(HOST_DAEMON_PROTOCOL)
  expect(record?.pid).toBe(process.pid)
  expect(record?.descriptor.token).toBe(published.token)
  expect(record?.roots.workspace).toBe(paths.workspaceRoot)
  expect(JSON.parse(await readFile(daemon.endpoint, 'utf8')).roots.hulala).toBe(paths.root)

  await prepared.lifecycle.dispose()
  expect(await exists(daemon.endpoint)).toBe(false)
  expect(await exists(daemon.lock)).toBe(false)
  // Disposal is idempotent across the stop path and an exit handler.
  await prepared.lifecycle.dispose()
})

test('attaches to a healthy daemon instead of booting a rival', async () => {
  const { daemon, config } = await fixture()
  // Another live process owns the lock; this test only simulates its files.
  await writeFile(daemon.lock, JSON.stringify({ pid: process.pid, version: '0.1.4', startedAt: '' }), 'utf8')
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      name: 'hulala-desktop-server',
      protocol: HOST_DAEMON_PROTOCOL,
      version: '0.1.4',
      instanceId: 'instance-1',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      runtime: { state: 'running' },
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const published = descriptor(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  await writeFile(daemon.endpoint, JSON.stringify({
    protocol: HOST_DAEMON_PROTOCOL,
    version: '0.1.4',
    pid: process.pid,
    startedAt: new Date().toISOString(),
    descriptor: published,
    roots: { hulala: config.hulalaRoot, workspace: config.workspaceRoot },
  }), 'utf8')

  const prepared = await prepareHostDaemon(config)
  expect(prepared.kind).toBe('already-running')
  if (prepared.kind !== 'already-running') throw new Error('expected an existing daemon')
  expect(prepared.record.descriptor.token).toBe(published.token)
  expect(prepared.health.runtime.state).toBe('running')
})

test('refuses an unreadable live lock instead of stealing it', async () => {
  const { daemon, config } = await fixture()
  await writeFile(daemon.lock, JSON.stringify({ pid: process.pid, version: '0.1.4', startedAt: '' }), 'utf8')
  const prepared = await prepareHostDaemon(config)
  expect(prepared.kind).toBe('conflict')
})

test('releases the lock only for its own pid', async () => {
  const { daemon } = await fixture()
  const lock = await acquireHostDaemonLock(daemon, { version: '0.1.4' })
  if (!lock.acquired) throw new Error('expected the lock')
  // A different owner replaced the file: our release must not delete theirs.
  await writeFile(daemon.lock, JSON.stringify({ pid: 1, version: '0.1.4', startedAt: '' }), 'utf8')
  await lock.release()
  expect(await exists(daemon.lock)).toBe(true)
})
