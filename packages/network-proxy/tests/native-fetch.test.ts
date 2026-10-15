import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createNativeProxyFetch, proxyForUrl } from '../src/native-fetch.ts'

test('native proxy selection preserves host, port, suffix, IPv6 and off rules', () => {
  const config = { httpProxy: 'http://proxy.invalid:8080', httpsProxy: 'http://secure.invalid:8080', noProxy: 'localhost, .example.test, [::1]:9000' }
  assert.equal(proxyForUrl('http://localhost:3210', config), false)
  assert.equal(proxyForUrl('https://child.example.test', config), false)
  assert.equal(proxyForUrl('https://notexample.test', config), config.httpsProxy)
  assert.equal(proxyForUrl('http://[::1]:9000', config), false)
  assert.equal(proxyForUrl('http://[::1]:9001', config), false)
  assert.equal(proxyForUrl('http://localhost:3210', { httpProxy: config.httpProxy }), false)
  assert.equal(proxyForUrl('http://provider.invalid', { ...config, noProxy: '*' }), false)
  assert.equal(proxyForUrl('http://provider.invalid', {}), false)
})

test('Bun native model streams stop on caller cancellation and Host shutdown without stopping other turns', { skip: !process.versions.bun }, async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: first chunk\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address === 'object')
  const lifetime = new AbortController()
  const fetch = createNativeProxyFetch(globalThis.fetch, {}, lifetime.signal)
  try {
    const caller = new AbortController()
    const url = `http://127.0.0.1:${address.port}`
    const first = await fetch(new Request(url, { signal: caller.signal }))
    const second = await fetch(url)
    const readers = [first.body!.getReader(), second.body!.getReader()]
    for (const reader of readers) assert.equal((await reader.read()).done, false)
    let otherStopped = false
    const reading = readers[0].read()
    const another = readers[1].read().finally(() => { otherStopped = true })
    const rejected = assert.rejects(reading, { name: 'AbortError' })
    const remaining = assert.rejects(another, { name: 'AbortError' })
    caller.abort()
    await rejected
    assert.equal(otherStopped, false)
    lifetime.abort()
    await remaining
  } finally {
    lifetime.abort()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('Bun native fetch uses the selected proxy and bypasses it only for excluded hosts', { skip: !process.versions.bun }, async () => {
  const direct = createServer((_request, response) => response.end('direct'))
  const proxy = createServer((request, response) => response.end('proxied: ' + request.url))
  for (const server of [direct, proxy]) await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const directAddress = direct.address(), proxyAddress = proxy.address()
  assert(directAddress && typeof directAddress === 'object' && proxyAddress && typeof proxyAddress === 'object')
  const lifetime = new AbortController()
  const fetch = createNativeProxyFetch(globalThis.fetch, { httpProxy: `http://127.0.0.1:${proxyAddress.port}`, noProxy: '127.0.0.1' }, lifetime.signal)
  try {
    assert.equal(await (await fetch('http://provider.invalid/model')).text(), 'proxied: http://provider.invalid/model')
    assert.equal(await (await fetch(`http://127.0.0.1:${directAddress.port}`)).text(), 'direct')
  } finally {
    lifetime.abort()
    for (const server of [direct, proxy]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  }
})
