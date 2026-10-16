import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { allowedLocalOrigin, authorizeRequest, connectionCookieName, createConnectionToken } from '../src/auth.ts'
import { createDesktopServer } from '../src/server.ts'
import { fakeNativeServices } from './harness-fixture.ts'

test('accepts only local browser origins', () => {
  expect(allowedLocalOrigin(null)).toBeFalse()
  expect(allowedLocalOrigin('null')).toBeFalse()
  expect(allowedLocalOrigin('file://')).toBeFalse()
  expect(allowedLocalOrigin('http://hulala.localhost:3210')).toBeTrue()
  expect(allowedLocalOrigin('http://127.0.0.1:3210')).toBeTrue()
  expect(allowedLocalOrigin('https://attacker.example')).toBeFalse()
})

test('requires an exact process connection token', () => {
  const token = createConnectionToken()
  const cookieName = connectionCookieName('instance-1')
  expect(token.length).toBeGreaterThanOrEqual(32)
  expect(cookieName).toBe('hulala_instance_1')
  expect(authorizeRequest(new Request('http://127.0.0.1/', { headers: { 'x-hulala-token': token } }), token, cookieName)).toBeTrue()
  expect(authorizeRequest(new Request('http://127.0.0.1/', { headers: {
    origin: 'http://127.0.0.1:5173', 'x-hulala-token': token,
  } }), token, cookieName)).toBeTrue()
  expect(authorizeRequest(new Request('http://127.0.0.1/', { headers: {
    origin: 'https://attacker.example', 'x-hulala-token': token,
  } }), token, cookieName)).toBeFalse()
  expect(authorizeRequest(new Request('http://127.0.0.1/', { headers: { cookie: `${cookieName}=${token}`, origin: 'http://127.0.0.1' } }), token, cookieName)).toBeTrue()
  expect(authorizeRequest(new Request('http://127.0.0.1/', { headers: { cookie: `${cookieName}=${token}` } }), token, cookieName)).toBeFalse()
  expect(authorizeRequest(new Request('http://127.0.0.1/', { headers: { cookie: `${cookieName}=${token}`, origin: 'http://localhost' } }), token, cookieName)).toBeFalse()
  expect(authorizeRequest(new Request(`http://127.0.0.1/?token=${token}`), token, cookieName)).toBeFalse()
  expect(authorizeRequest(new Request('http://127.0.0.1/', { headers: { 'x-hulala-token': `${token}x` } }), token, cookieName)).toBeFalse()
})

test('private event WebSocket rejects missing, query, and cross-origin credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-ws-auth-'))
  const handle = await createDesktopServer({
    host: '127.0.0.1',
    port: 0,
    hulalaRoot: root,
    workspaceRoot: join(root, 'managed-workspaces'),
    version: 'test',
  }, fakeNativeServices())
  const httpEventsUrl = handle.descriptor.eventsUrl.replace(/^ws:/, 'http:')
  try {
    expect((await fetch(httpEventsUrl)).status).toBe(403)
    expect((await fetch(`${httpEventsUrl}?token=${encodeURIComponent(handle.descriptor.token)}`)).status).toBe(403)
    expect((await fetch(httpEventsUrl, { headers: {
      origin: 'https://attacker.example', 'x-hulala-token': handle.descriptor.token,
    } })).status).toBe(403)
    const socket = new WebSocket(handle.descriptor.eventsUrl, {
      headers: { origin: handle.descriptor.httpUrl, 'x-hulala-token': handle.descriptor.token },
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    const close = new Promise<number>(resolve => socket.once('close', code => resolve(code)))
    socket.send('client messages are forbidden')
    expect(await close).toBe(1008)
  } finally {
    await handle.stop()
    await rm(root, { recursive: true, force: true })
  }
})
