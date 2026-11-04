import { afterEach, test, expect } from 'bun:test'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HOST_DAEMON_PROTOCOL } from '@hulala/desktop-contracts'
import { createDesktopHost, type DesktopHostHandle } from '../src/host.ts'

const hosts: DesktopHostHandle[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function remoteRequest(method: string, args: Record<string, unknown>): string {
  return JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } })
}

test('publishes the DSH transport and keeps only the Host assembly surface', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-host-'))
  roots.push(root)
  const workspaceRoot = join(root, 'workspaces')
  const host = await createDesktopHost({
    host: '127.0.0.1',
    port: 0,
    hulalaRoot: root,
    workspaceRoot,
    version: 'test',
    daemon: false,
  })
  hosts.push(host)

  const healthResponse = await fetch(`${host.descriptor.httpUrl}/health`)
  expect(healthResponse.status).toBe(200)
  const health = await healthResponse.json() as { name?: unknown; protocol?: unknown; instanceId?: unknown; pid?: unknown; runtime?: { state?: unknown } }
  expect(health).toMatchObject({
    name: 'hulala-desktop-server',
    protocol: HOST_DAEMON_PROTOCOL,
    instanceId: host.descriptor.instanceId,
    pid: process.pid,
    runtime: { state: 'running' },
  })

  const exchange = await fetch(
    `${host.descriptor.httpUrl}/connect?token=${encodeURIComponent(host.descriptor.token)}&interactions=answer`,
    { redirect: 'manual' },
  )
  expect(exchange.status).toBe(302)
  const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
  expect(cookie).toContain('dsh-auth-')
  expect(exchange.headers.get('location')).toBe('./api/remote.mux')

  const unauthenticated = await fetch(`${host.descriptor.httpUrl}/api/session/list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: remoteRequest('session/list', {}),
  })
  expect(unauthenticated.status).toBe(401)

  const sessions = await fetch(`${host.descriptor.httpUrl}/api/session/list`, {
    method: 'POST',
    headers: { cookie: cookie as string, 'content-type': 'application/json' },
    body: remoteRequest('session/list', { _request: {} }),
  })
  expect(sessions.status).toBe(200)
  expect(await sessions.json()).toMatchObject({ type: 'server-response', result: { ok: true, value: { items: [] } } })

  const write = await fetch(`${host.descriptor.httpUrl}/api/hulalaFiles/writeText`, {
    method: 'POST',
    headers: { cookie: cookie as string, 'content-type': 'application/json' },
    body: remoteRequest('hulalaFiles/writeText', {
      workspaceRoot,
      path: 'notes/native.txt',
      content: 'written through the DSH Remote carrier',
    }),
  })
  expect(write.status).toBe(200)
  expect(await write.json()).toMatchObject({
    type: 'server-response',
    result: { ok: true, value: { path: join(await realpath(workspaceRoot), 'notes', 'native.txt') } },
  })
  expect(await readFile(join(workspaceRoot, 'notes', 'native.txt'), 'utf8')).toBe('written through the DSH Remote carrier')
}, 120_000)

test('the Host descriptor points at the DSH mux instead of a private event route', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-host-transport-'))
  roots.push(root)
  const host = await createDesktopHost({
    host: '127.0.0.1',
    port: 0,
    hulalaRoot: root,
    workspaceRoot: join(root, 'workspaces'),
    version: 'test',
    daemon: false,
  })
  hosts.push(host)
  expect(host.descriptor.eventsUrl).toBe(`${host.descriptor.httpUrl.replace(/^http/u, 'ws')}/api/remote.mux`)
  expect(host.descriptor.token.length).toBeGreaterThanOrEqual(32)
}, 120_000)
