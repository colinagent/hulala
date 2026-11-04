import { afterEach, test, expect } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HOST_DAEMON_PROTOCOL } from '../src/protocol'
import {
  discoverHostDaemon,
  hostEndpointRecordSchema,
  readHostEndpoint,
  resolveHostDaemonPaths,
} from '../src/discovery'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hulala-host-daemon-contracts-'))
  roots.push(root)
  const paths = { server: join(root, 'state', 'server'), logs: join(root, 'state', 'logs') }
  return { root, paths, daemon: resolveHostDaemonPaths(paths) }
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    protocol: HOST_DAEMON_PROTOCOL,
    version: '0.1.4',
    pid: process.pid,
    startedAt: new Date().toISOString(),
    descriptor: {
      httpUrl: 'http://127.0.0.1:43121',
      eventsUrl: 'ws://127.0.0.1:43121/api/desktop/v1/events',
      token: 't'.repeat(43),
      instanceId: 'instance-1',
      authCookieName: 'hulala_instance_1',
    },
    roots: { hulala: '/tmp/hulala', workspace: '/tmp/hulala-workspace' },
    ...overrides,
  }
}

test('resolves daemon files under the canonical state children', async () => {
  const { paths, daemon } = await fixture()
  expect(daemon.directory).toBe(join(paths.server, 'host'))
  expect(daemon.endpoint).toBe(join(paths.server, 'host', 'endpoint.json'))
  expect(daemon.lock).toBe(join(paths.server, 'host', 'host.lock'))
  expect(daemon.log).toBe(join(paths.logs, 'host.log'))
})

test('reads a published endpoint and rejects malformed files', async () => {
  const { daemon } = await fixture()
  await mkdir(daemon.directory, { recursive: true })
  await writeFile(daemon.endpoint, JSON.stringify(record()), 'utf8')
  expect((await readHostEndpoint(daemon))?.descriptor.instanceId).toBe('instance-1')

  await writeFile(daemon.endpoint, '{"protocol":1}', 'utf8')
  expect(await readHostEndpoint(daemon)).toBeUndefined()
  expect(hostEndpointRecordSchema.safeParse(record({ protocol: 0 })).success).toBe(false)
})

test('discovers missing, incompatible, unhealthy and ready daemons', async () => {
  const { daemon } = await fixture()
  await mkdir(daemon.directory, { recursive: true })

  expect(await discoverHostDaemon(daemon)).toEqual({ status: 'missing' })

  await writeFile(daemon.endpoint, JSON.stringify(record({ protocol: HOST_DAEMON_PROTOCOL + 1 })), 'utf8')
  expect((await discoverHostDaemon(daemon)).status).toBe('incompatible')

  const published = record()
  await writeFile(daemon.endpoint, JSON.stringify(published), 'utf8')
  expect((await discoverHostDaemon(daemon, {
    fetch: (async () => new Response('not json', { status: 500 })) as unknown as typeof fetch,
  })).status).toBe('unhealthy')

  const health = {
    name: 'hulala-desktop-server',
    protocol: HOST_DAEMON_PROTOCOL,
    version: '0.1.4',
    instanceId: published.descriptor.instanceId,
    pid: published.pid,
    startedAt: new Date().toISOString(),
    runtime: { state: 'running' },
    paths: { root: '/tmp/hulala', workspace: '/tmp/hulala-workspace' },
  }
  const ready = await discoverHostDaemon(daemon, {
    fetch: (async () => Response.json(health)) as unknown as typeof fetch,
  })
  expect(ready.status).toBe('ready')
  if (ready.status !== 'ready') throw new Error('expected a ready daemon')
  expect(ready.health.instanceId).toBe('instance-1')
})

test('rejects health answered by a different process or instance', async () => {
  const { daemon } = await fixture()
  await mkdir(daemon.directory, { recursive: true })
  const published = record()
  await writeFile(daemon.endpoint, JSON.stringify(published), 'utf8')
  const health = {
    name: 'hulala-desktop-server',
    protocol: HOST_DAEMON_PROTOCOL,
    version: '0.1.4',
    instanceId: 'another-instance',
    pid: published.pid,
    startedAt: new Date().toISOString(),
    runtime: { state: 'running' },
  }
  const outcome = await discoverHostDaemon(daemon, {
    fetch: (async () => Response.json(health)) as unknown as typeof fetch,
  })
  expect(outcome.status).toBe('unhealthy')
})

test('a live process speaking another protocol is incompatible, not unhealthy', async () => {
  const { daemon } = await fixture()
  await mkdir(daemon.directory, { recursive: true })
  const published = record()
  await writeFile(daemon.endpoint, JSON.stringify(published), 'utf8')
  const health = {
    name: 'hulala-desktop-server',
    // A newer Host reused the endpoint file while this client still speaks protocol 1.
    protocol: HOST_DAEMON_PROTOCOL + 1,
    version: '0.1.4',
    instanceId: published.descriptor.instanceId,
    pid: published.pid,
    startedAt: new Date().toISOString(),
    runtime: { state: 'running' },
  }
  expect((await discoverHostDaemon(daemon, {
    fetch: (async () => Response.json(health)) as unknown as typeof fetch,
  })).status).toBe('incompatible')
})

test('health without a protocol is not trusted', async () => {
  const { daemon } = await fixture()
  await mkdir(daemon.directory, { recursive: true })
  const published = record()
  await writeFile(daemon.endpoint, JSON.stringify(published), 'utf8')
  const legacy = {
    name: 'hulala-desktop-server',
    version: '0.1.4',
    instanceId: published.descriptor.instanceId,
    pid: published.pid,
    startedAt: new Date().toISOString(),
    runtime: { state: 'running' },
  }
  expect((await discoverHostDaemon(daemon, {
    fetch: (async () => Response.json(legacy)) as unknown as typeof fetch,
  })).status).toBe('unhealthy')
})
