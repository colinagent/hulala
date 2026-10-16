import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONNECTION_TOKEN_HEADER } from '@hulala/workbench-contracts'
import { createDesktopServer, type DesktopServerHandle } from '../src/server.ts'
import { fakeHarnessClient, fakeNativeServices } from './harness-fixture.ts'

const handles: DesktopServerHandle[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map(handle => handle.stop()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

test('does not expose the Harness HTTP proxy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-server-proxy-test-'))
  roots.push(root)
  const handle = await createDesktopServer({
    host: '127.0.0.1',
    port: 0,
    hulalaRoot: root,
    workspaceRoot: join(root, 'managed-workspaces'),
    version: 'test',
  }, fakeNativeServices())
  handles.push(handle)
  const response = await fetch(`${handle.descriptor.httpUrl}/api/hulala/runtimes`, {
    headers: {
      [CONNECTION_TOKEN_HEADER]: handle.descriptor.token,
      origin: 'null',
      'sec-fetch-site': 'cross-site',
    },
  })
  expect(response.status).toBe(403)

  const trusted = await fetch(`${handle.descriptor.httpUrl}/api/hulala/runtimes`, {
    headers: {
      [CONNECTION_TOKEN_HEADER]: handle.descriptor.token,
      'sec-fetch-site': 'cross-site',
    },
  })
  expect(trusted.status).toBe(404)
})

test('rejects same-origin attempts to reach a Harness route through the private Server', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-server-origin-proxy-test-'))
  roots.push(root)
  const handle = await createDesktopServer({
    host: '127.0.0.1',
    port: 0,
    hulalaRoot: root,
    workspaceRoot: join(root, 'managed-workspaces'),
    version: 'test',
  }, fakeNativeServices())
  handles.push(handle)
  const response = await fetch(`${handle.descriptor.httpUrl}/api/llm.providers`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${handle.descriptor.authCookieName}=${handle.descriptor.token}`,
      origin: new URL(handle.descriptor.httpUrl).origin,
      referer: `${handle.descriptor.httpUrl}/`,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'llm/listConfigurableProviders', payload: {} }),
  })
  expect(response.status).toBe(404)
})

test('opens a native conversation and reuses an unarchived blank workspace session', async () => {
  const sessionId = '7f5f72d8-7ae5-4e45-933f-4c33fb0bd407'
  const harnessWorkspaceId = 'workspace-harness'
  const fixture = fakeHarnessClient({
    unary(method, payload) {
      const value = method === 'workspace/create'
        ? { workspace: { workspaceId: harnessWorkspaceId, path: String(payload.path), title: 'workspace', sessionIds: [sessionId], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, created: true }
        : method === 'workspace/follow'
          ? { items: [{ workspaceId: harnessWorkspaceId, path: roots.at(-1), title: 'workspace', sessionIds: [sessionId], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], archivedSessionIds: [] }
          : method === 'session/list'
            ? { items: [{ sessionId, cwd: roots.at(-1), blank: true, running: false, updatedAt: Date.now() }] }
            : method === 'session/follow'
              ? { events: [], hasMore: false, projections: { asOfSeq: -1, values: {} } }
              : { sessionId: 'unexpected-created-session' }
      return value
    },
  })
  const root = await mkdtemp(join(tmpdir(), 'hulala-server-intent-test-'))
  roots.push(root)
  const handle = await createDesktopServer({
    host: '127.0.0.1',
    port: 0,
    hulalaRoot: root,
    workspaceRoot: join(root, 'managed-workspaces'),
    version: 'test',
  }, { ...fakeNativeServices(), ...fixture.services })
  handles.push(handle)
  const headers = { [CONNECTION_TOKEN_HEADER]: handle.descriptor.token }
  const workspaces = await (await fetch(`${handle.descriptor.httpUrl}/api/desktop/v1/workspaces`, { headers })).json() as {
    items: Array<{ id: string }>
  }
  const response = await fetch(`${handle.descriptor.httpUrl}/api/desktop/v1/conversations/open`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'workspace', workspaceId: workspaces.items[0].id }),
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    sessionId,
    snapshot: { session: { sessionId, blank: true, running: false }, items: [] },
  })
  expect(fixture.calls).toContain('workspace/create')
  expect(fixture.calls).toContain('session/follow')
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hulala-server-test-'))
  roots.push(root)
  const handle = await createDesktopServer({
    host: '127.0.0.1',
    port: 0,
    hulalaRoot: root,
    workspaceRoot: join(root, 'managed-workspaces'),
    version: 'test',
  }, fakeNativeServices())
  handles.push(handle)
  const request = (path: string, init: RequestInit = {}) => fetch(`${handle.descriptor.httpUrl}${path}`, {
    ...init,
    headers: { [CONNECTION_TOKEN_HEADER]: handle.descriptor.token, ...init.headers },
  })
  return { root, handle, request }
}

test('rejects requests without the process token', async () => {
  const { handle } = await fixture()
  const response = await fetch(`${handle.descriptor.httpUrl}/api/desktop/v1/health`)
  expect(response.status).toBe(403)
  const queryToken = await fetch(`${handle.descriptor.httpUrl}/?token=${encodeURIComponent(handle.descriptor.token)}`)
  expect(queryToken.status).toBe(403)
})

test('exposes health and keeps all server state under injected HULALA_HOME', async () => {
  const { root, handle, request } = await fixture()
  const response = await request('/api/desktop/v1/health')
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    name: 'hulala-desktop-server',
    version: 'test',
    runtime: { state: 'disabled' },
  })
  expect(Object.values(handle.paths).every(path => path.startsWith(root))).toBeTrue()
})

test('returns a Session artifact location without reading or exposing its contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-session-location-test-'))
  roots.push(root)
  const sessionId = 'session-location-1234'
  const sessionPath = join(root, 'runtime', 'sessions', sessionId, 'session.v3.jsonl.zstd')
  const handle = await createDesktopServer({
    host: '127.0.0.1',
    port: 0,
    hulalaRoot: root,
    workspaceRoot: join(root, 'managed-workspaces'),
    version: 'test',
  }, {
    ...fakeNativeServices(),
    sessionPersistence: {
      stat: async () => ({ header: { id: sessionId } }),
      flush: async () => {},
      resolveCurrentLog: async () => sessionPath,
    } as never,
  })
  handles.push(handle)

  const response = await fetch(
    `${handle.descriptor.httpUrl}/api/desktop/v1/conversations/${sessionId}/location`,
    { headers: { [CONNECTION_TOKEN_HEADER]: handle.descriptor.token } },
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ sessionId, kind: 'jsonl', path: sessionPath })
})

test('creates a managed Workspace through the typed private API and reports collisions', async () => {
  const { handle, request } = await fixture()
  const created = await request('/api/desktop/v1/workspaces/managed', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '项目 Alpha' }),
  })
  expect(created.status).toBe(201)
  expect(await created.json()).toMatchObject({
    name: '项目 Alpha',
    path: await realpath(join(handle.paths.workspaceRoot, '项目 Alpha')),
  })

  const collision = await request('/api/desktop/v1/workspaces/managed', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '项目 Alpha' }),
  })
  expect(collision.status).toBe(409)
  expect(await collision.json()).toMatchObject({ code: 'workspace_exists' })

  const invalid = await request('/api/desktop/v1/workspaces/managed', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '../escape' }),
  })
  expect(invalid.status).toBe(400)
  expect(await invalid.json()).toMatchObject({ code: 'workspace_name_invalid' })
})

test('round-trips a file through the private typed API', async () => {
  const { request } = await fixture()
  const workspaces = await (await request('/api/desktop/v1/workspaces')).json() as { items: Array<{ id: string }> }
  const workspaceId = workspaces.items[0].id
  const write = await request('/api/desktop/v1/files/text', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId, path: 'hello.md', content: '# hello', expectedVersion: null }),
  })
  expect(write.status).toBe(200)
  const read = await request(`/api/desktop/v1/files/text?workspaceId=${workspaceId}&path=hello.md`)
  expect(await read.json()).toMatchObject({ content: '# hello' })
})

test('returns a typed 404 when an optional workspace file does not exist', async () => {
  const { request } = await fixture()
  const workspaces = await (await request('/api/desktop/v1/workspaces')).json() as { items: Array<{ id: string }> }
  const workspaceId = workspaces.items[0].id
  const response = await request(
    `/api/desktop/v1/files/text?workspaceId=${workspaceId}&path=${encodeURIComponent('missing-highlights.md')}`,
  )
  expect(response.status).toBe(404)
  expect(await response.json()).toMatchObject({ code: 'file_not_found', message: 'file not found' })
})

test('streams Unicode resource names with an ASCII-safe content disposition', async () => {
  const { request } = await fixture()
  const workspaces = await (await request('/api/desktop/v1/workspaces')).json() as { items: Array<{ id: string }> }
  const workspaceId = workspaces.items[0].id
  const fileName = '数学觉醒 (David Bessis).epub'
  const write = await request('/api/desktop/v1/files/text', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId, path: fileName, content: 'book', expectedVersion: null }),
  })
  expect(write.status).toBe(200)

  const created = await request('/api/desktop/v1/resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId, path: fileName }),
  })
  expect(created.status).toBe(201)
  const handle = await created.json() as { id: string }
  const resource = await request(`/api/desktop/v1/resources/${handle.id}`)
  expect(resource.status).toBe(200)
  expect(await resource.text()).toBe('book')

  const disposition = resource.headers.get('content-disposition') ?? ''
  expect(disposition).toContain('inline; filename="')
  expect(disposition).toContain("filename*=UTF-8''%E6%95%B0%E5%AD%A6%E8%A7%89%E9%86%92")
  expect(/^[\x00-\x7f]*$/.test(disposition)).toBeTrue()
})

test('uploads and commits transfer bytes through the authenticated private API', async () => {
  const { request } = await fixture()
  const workspaces = await (await request('/api/desktop/v1/workspaces')).json() as { items: Array<{ id: string }> }
  const workspaceId = workspaces.items[0].id
  const created = await request('/api/desktop/v1/transfers', { method: 'POST' })
  expect(created.status).toBe(201)
  const transfer = await created.json() as { id: string }
  const uploaded = await request(`/api/desktop/v1/transfers/${transfer.id}/content`, {
    method: 'PUT',
    headers: { 'content-type': 'image/png', 'content-length': '8' },
    body: Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4]),
  })
  expect(uploaded.status).toBe(200)
  const committed = await request(`/api/desktop/v1/transfers/${transfer.id}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId, path: '素材/粘贴图片.png' }),
  })
  expect(committed.status).toBe(200)
  const commitResult = await committed.json() as { ok: true; resource: { id: string; name: string } }
  expect(commitResult.ok).toBeTrue()
  expect(commitResult.resource.name).toBe('粘贴图片.png')
  const resourceHandle = commitResult.resource
  const resource = await request(`/api/desktop/v1/resources/${resourceHandle.id}`)
  expect([...new Uint8Array(await resource.arrayBuffer())]).toEqual([137, 80, 78, 71, 1, 2, 3, 4])
})

test('imports a Unicode workspace resource atomically and returns its render handle', async () => {
  const { request } = await fixture()
  const workspaces = await (await request('/api/desktop/v1/workspaces')).json() as { items: Array<{ id: string }> }
  const workspaceId = workspaces.items[0].id
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
  const imported = await request(
    `/api/desktop/v1/resources/import?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent('个人成长/assets/直觉图片.png')}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'content-length': String(bytes.byteLength) },
      body: bytes,
    },
  )
  expect(imported.status).toBe(201)
  const result = await imported.json() as { ok: true; resource: { id: string; name: string; size: number } }
  expect(result).toMatchObject({ ok: true, resource: { name: '直觉图片.png', size: bytes.byteLength } })

  const resource = await request(`/api/desktop/v1/resources/${result.resource.id}`)
  expect(resource.status).toBe(200)
  expect([...new Uint8Array(await resource.arrayBuffer())]).toEqual([...bytes])
})
