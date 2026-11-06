import { afterEach, test, expect } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HOST_DAEMON_PROTOCOL } from '../src/protocol'
import {
  HostDaemonError,
  discoverHostDaemon,
  ensureHostDaemon,
  resolveHostDaemonPaths,
  stopHostDaemon,
  type HostDaemonLaunchSpec,
  type HostEndpointRecord,
} from '../src/node'

const roots: string[] = []
const children: Array<{ kill: (signal?: NodeJS.Signals) => void, exited: Promise<number> }> = []

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL')
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(): Promise<{ paths: { server: string, logs: string }, endpoint: string, log: string }> {
  const root = await mkdtemp(join(tmpdir(), 'hulala-host-client-'))
  roots.push(root)
  const server = join(root, 'server')
  const logs = join(root, 'logs')
  await mkdir(join(server, 'host'), { recursive: true, mode: 0o700 })
  await mkdir(logs, { recursive: true, mode: 0o700 })
  return { paths: { server, logs }, endpoint: join(server, 'host', 'endpoint.json'), log: join(logs, 'host.log') }
}

function record(overrides: Partial<HostEndpointRecord> = {}): HostEndpointRecord {
  return {
    protocol: HOST_DAEMON_PROTOCOL,
    version: '0.1.4',
    pid: 4242,
    startedAt: new Date().toISOString(),
    descriptor: {
      httpUrl: 'http://127.0.0.1:4399',
      eventsUrl: 'ws://127.0.0.1:4399/events',
      token: 'client-fixture-token-000000000000',
      instanceId: 'instance-1',
      authCookieName: 'hulala_fixture',
    },
    roots: { hulala: '/tmp/hulala', workspace: '/tmp/hulala-workspace' },
    ...overrides,
  }
}

function health(published: HostEndpointRecord) {
  return {
    name: 'hulala-desktop-server',
    protocol: published.protocol,
    version: published.version,
    instanceId: published.descriptor.instanceId,
    pid: published.pid,
    startedAt: published.startedAt,
    runtime: { state: 'running' },
  }
}

const answering = (published: HostEndpointRecord) => (async () => Response.json(health(published))) as unknown as typeof fetch

test('attaches to a healthy daemon without starting one', async () => {
  const { paths, endpoint } = await fixture()
  const published = record()
  await writeFile(endpoint, JSON.stringify(published))
  let launched = 0
  const connection = await ensureHostDaemon({
    paths,
    fetch: answering(published),
    spawn: { command: 'unused', args: [] },
    launch: () => { launched += 1 },
  })
  expect(connection.started).toBe(false)
  expect(connection.record.descriptor.instanceId).toBe('instance-1')
  expect(connection.health.runtime.state).toBe('running')
  expect(launched).toBe(0)
})

test('refuses to start when the caller only wants to attach', async () => {
  const { paths } = await fixture()
  const error = await ensureHostDaemon({ paths, spawn: false }).catch(caught => caught)
  expect(error).toBeInstanceOf(HostDaemonError)
  expect(error.code).toBe('not-running')
})

test('a live Host speaking another protocol reports incompatibility, not a start', async () => {
  const { paths, endpoint } = await fixture()
  const published = record({ protocol: HOST_DAEMON_PROTOCOL + 1 })
  await writeFile(endpoint, JSON.stringify(published))
  let launched = 0
  const error = await ensureHostDaemon({
    paths,
    fetch: answering(published),
    spawn: { command: 'unused', args: [] },
    launch: () => { launched += 1 },
  }).catch(caught => caught)
  expect(error.code).toBe('incompatible')
  expect(error.message).toContain(`protocol ${HOST_DAEMON_PROTOCOL + 1}`)
  expect(launched).toBe(0)
})

test('a stale endpoint from a dead Host is replaced by a fresh daemon', async () => {
  const { paths, endpoint, log } = await fixture()
  await writeFile(endpoint, JSON.stringify(record({ pid: 999_999 })))
  const published = record({ pid: 4343, descriptor: { ...record().descriptor, instanceId: 'instance-2' } })
  const specs: Array<{ spec: HostDaemonLaunchSpec, log: string }> = []
  const connection = await ensureHostDaemon({
    paths,
    spawn: { command: 'node', args: ['--daemon'] },
    launch: async (spec, logPath) => {
      specs.push({ spec, log: logPath })
      await writeFile(endpoint, JSON.stringify(published))
    },
    fetch: answering(published),
    intervalMs: 1,
  })
  expect(connection.started).toBe(true)
  expect(connection.record.descriptor.instanceId).toBe('instance-2')
  expect(specs).toHaveLength(1)
  expect(specs[0]!.spec.args).toEqual(['--daemon'])
  expect(specs[0]!.log).toBe(log)
})

test('a Host that never publishes an endpoint fails with its log path', async () => {
  const { paths, log } = await fixture()
  const error = await ensureHostDaemon({
    paths,
    spawn: { command: 'node', args: ['--daemon'] },
    launch: () => {},
    timeoutMs: 120,
    intervalMs: 10,
  }).catch(caught => caught)
  expect(error.code).toBe('start-timeout')
  expect(error.message).toContain(log)
})

test('a rejected launch is reported as start-failed', async () => {
  const { paths } = await fixture()
  const error = await ensureHostDaemon({
    paths,
    spawn: { command: 'node', args: ['--daemon'] },
    launch: () => { throw new Error('spawn EACCES') },
  }).catch(caught => caught)
  expect(error.code).toBe('start-failed')
  expect(error.cause.message).toContain('EACCES')
})

test('stopping a daemon terminates the process and removes its endpoint', async () => {
  const { paths, endpoint, log } = await fixture()
  const script = join(paths.logs, 'daemon.mjs')
  await writeFile(script, `
import { createServer } from 'node:http'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
const endpoint = process.argv[2]
const instanceId = 'instance-live'
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ name: 'hulala-desktop-server', protocol: ${HOST_DAEMON_PROTOCOL}, version: '0.1.4', instanceId, pid: process.pid, startedAt: new Date().toISOString(), runtime: { state: 'running' } }))
})
server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address()
  await mkdir(dirname(endpoint), { recursive: true, mode: 0o700 })
  await writeFile(endpoint, JSON.stringify({
    protocol: ${HOST_DAEMON_PROTOCOL}, version: '0.1.4', pid: process.pid, startedAt: new Date().toISOString(),
    descriptor: { httpUrl: 'http://127.0.0.1:' + port, eventsUrl: 'ws://127.0.0.1:' + port + '/events', token: 'client-fixture-token-000000000000', instanceId, authCookieName: 'hulala_live' },
    roots: { hulala: '/tmp/hulala', workspace: '/tmp/hulala-workspace' },
  }))
})
process.on('SIGTERM', async () => { await rm(endpoint, { force: true }); server.close(); process.exit(0) })
`)
  const child = Bun.spawn([process.execPath, script, endpoint], { stdout: 'ignore', stderr: 'pipe', env: { ...process.env } })
  children.push(child as unknown as typeof children[number])

  const files = resolveHostDaemonPaths(paths)
  const deadline = Date.now() + 10_000
  let discovery = await discoverHostDaemon(files)
  while (discovery.status !== 'ready' && Date.now() < deadline) {
    await Bun.sleep(20)
    discovery = await discoverHostDaemon(files)
  }
  expect(discovery.status).toBe('ready')
  if (discovery.status !== 'ready') throw new Error('daemon never became ready')
  expect(discovery.record.descriptor.instanceId).toBe('instance-live')

  expect(await stopHostDaemon(paths, { intervalMs: 20, timeoutMs: 5_000 })).toBe('stopped')
  await child.exited
  expect(child.exitCode).toBe(0)
  expect(await readFile(endpoint, 'utf8').catch(() => undefined)).toBeUndefined()
})

test('stopping when no endpoint is published is a no-op', async () => {
  const { paths } = await fixture()
  expect(await stopHostDaemon(paths)).toBe('absent')
})

test('a live Host from another version is reported instead of attached', async () => {
  const { paths, endpoint } = await fixture()
  const published = record({ version: '0.2.12' })
  await writeFile(endpoint, JSON.stringify(published))
  let launched = 0
  const error = await ensureHostDaemon({
    paths,
    version: '0.2.19',
    fetch: answering(published),
    spawn: { command: 'unused', args: [] },
    launch: () => { launched += 1 },
  }).catch(caught => caught)
  expect(error).toBeInstanceOf(HostDaemonError)
  expect(error.code).toBe('version-mismatch')
  expect(error.message).toContain('Hulala 0.2.12 is still running')
  expect(error.message).toContain('hulala host stop')
  expect(error.message).toContain('0.2.19')
  expect(launched).toBe(0)
})

test('a live Host from this version still attaches', async () => {
  const { paths, endpoint } = await fixture()
  const published = record({ version: '0.2.19' })
  await writeFile(endpoint, JSON.stringify(published))
  const connection = await ensureHostDaemon({
    paths,
    version: '0.2.19',
    fetch: answering(published),
    spawn: false,
  })
  expect(connection.started).toBe(false)
  expect(connection.record.version).toBe('0.2.19')
})
