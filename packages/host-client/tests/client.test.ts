import { test, expect } from 'bun:test'
import { z } from 'zod'
import { HOST_DAEMON_PROTOCOL, type Health } from '../src/protocol'
import { HostClient, HostClientError, assertHostProtocol } from '../src/index'

const descriptor = {
  httpUrl: 'http://127.0.0.1:4399',
  eventsUrl: 'ws://127.0.0.1:4399/events',
  token: 'client-fixture-token-000000000000',
  instanceId: 'instance-1',
  authCookieName: 'hulala_fixture',
}

function health(protocol = HOST_DAEMON_PROTOCOL): Health {
  return {
    name: 'hulala-desktop-server',
    protocol,
    version: '0.1.4',
    instanceId: 'instance-1',
    pid: 4242,
    startedAt: new Date().toISOString(),
    runtime: { state: 'running' },
  }
}

test('requests carry the Host token and resolve against the API prefix', async () => {
  const seen: Array<{ url: string, token: string | null, method?: string }> = []
  const client = new HostClient({
    baseUrl: descriptor.httpUrl + '/',
    token: descriptor.token,
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), token: new Headers(init.headers).get('x-hulala-token'), method: init.method })
      return Response.json(health())
    }) as unknown as typeof fetch,
  })
  const parsed = await client.health()
  expect(parsed.protocol).toBe(HOST_DAEMON_PROTOCOL)
  expect(seen).toEqual([{ url: 'http://127.0.0.1:4399/api/desktop/v1/health', token: descriptor.token, method: undefined }])
})

test('JSON bodies are serialized and responses are validated', async () => {
  let body: string | undefined
  let contentType: string | null = null
  const client = HostClient.fromDescriptor(descriptor, {
    fetch: (async (_url: string, init: RequestInit) => {
      body = String(init.body)
      contentType = new Headers(init.headers).get('content-type')
      return Response.json({ ok: true })
    }) as unknown as typeof fetch,
  })
  const parsed = await client.json('/probe', z.object({ ok: z.boolean() }), { method: 'POST', json: { question: 'yes' } })
  expect(parsed).toEqual({ ok: true })
  expect(contentType!).toBe('application/json')
  expect(JSON.parse(body!)).toEqual({ question: 'yes' })
})

test('a body that violates the contract is rejected', async () => {
  const client = HostClient.fromDescriptor(descriptor, {
    fetch: (async () => Response.json({ ok: 'yes' })) as unknown as typeof fetch,
  })
  await expect(client.json('/probe', z.object({ ok: z.boolean() }))).rejects.toThrow()
})

test('Host failures surface their code and message', async () => {
  const client = HostClient.fromDescriptor(descriptor, {
    fetch: (async () => Response.json({ code: 'workspace_not_found', message: 'workspace is gone' }, { status: 404 })) as unknown as typeof fetch,
  })
  const error = await client.send('/workspaces/missing').catch(caught => caught)
  expect(error).toBeInstanceOf(HostClientError)
  expect(error.status).toBe(404)
  expect(error.code).toBe('workspace_not_found')
  expect(error.message).toBe('workspace is gone')
})

test('an unreachable Host is reported instead of throwing a transport error', async () => {
  const client = HostClient.fromDescriptor(descriptor, {
    fetch: (async () => { throw new ENOENTLike() }) as unknown as typeof fetch,
  })
  const error = await client.health().catch(caught => caught)
  expect(error.code).toBe('host_unreachable')
  expect(error.status).toBe(0)
})

test('a protocol mismatch is named with both versions', () => {
  expect(() => assertHostProtocol(health())).not.toThrow()
  expect(() => assertHostProtocol(health(HOST_DAEMON_PROTOCOL + 1))).toThrow(
    new RegExp(`protocol ${HOST_DAEMON_PROTOCOL + 1}, but this client requires ${HOST_DAEMON_PROTOCOL}`),
  )
})

class ENOENTLike extends Error {
  constructor() { super('connect ECONNREFUSED 127.0.0.1:4399') }
}
