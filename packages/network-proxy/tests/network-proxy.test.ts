import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { fetch } from 'undici'
import { createProxyDispatcher, parseMacosSystemProxy, proxyChildEnv, redactProxyUrl, resolveProxy, validateProxyUrl } from '../src/index.ts'

test('manual mode overrides environment and redacts credentials', () => {
  const resolved = resolveProxy({ mode: 'manual', proxyUrl: 'http://user:secret@127.0.0.1:7897' }, {
    HTTPS_PROXY: 'http://environment:8080', NO_PROXY: 'localhost',
  }, {})
  assert.equal(resolved.source, 'manual')
  assert.equal(resolved.httpsProxy, 'http://user:secret@127.0.0.1:7897/')
  assert.equal(redactProxyUrl(resolved.httpsProxy), 'http://***:***@127.0.0.1:7897/')
})

test('off mode strips proxy variables from child processes', () => {
  const resolved = resolveProxy({ mode: 'off' }, { HTTPS_PROXY: 'http://proxy', https_proxy: 'http://proxy', PATH: '/bin' }, {})
  assert.deepEqual(proxyChildEnv(resolved, { HTTPS_PROXY: 'http://proxy', https_proxy: 'http://proxy', PATH: '/bin' }), { PATH: '/bin' })
})

test('auto mode prefers Hulala, environment, then macOS system proxy', () => {
  assert.equal(resolveProxy({ mode: 'auto' }, { HULALA_PROXY: 'http://127.0.0.1:1' }, {}).source, 'hulala-env')
  assert.equal(resolveProxy({ mode: 'auto' }, { HTTPS_PROXY: 'http://127.0.0.1:2' }, {}).source, 'environment')
  assert.equal(resolveProxy({ mode: 'auto' }, {}, { httpsProxy: 'http://127.0.0.1:3' }).source, 'macos-system')
})

test('parses Clash-style macOS system proxy output', () => {
  const parsed = parseMacosSystemProxy(`<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : localhost
  }
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
}`)
  assert.deepEqual(parsed, {
    httpProxy: 'http://127.0.0.1:7897',
    httpsProxy: 'http://127.0.0.1:7897',
    noProxy: '127.0.0.1,localhost',
  })
})

test('rejects SOCKS and malformed manual proxy URLs', () => {
  assert.throws(() => validateProxyUrl('socks5://127.0.0.1:7897'), /Only http/)
  assert.throws(() => validateProxyUrl('not a url'), /valid absolute/)
})

test('routes HTTP requests through the resolved proxy dispatcher', async () => {
  let seenUrl = ''
  const server = createServer((request, response) => {
    seenUrl = request.url ?? ''
    response.end('through proxy')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address === 'object')
  const resolved = resolveProxy({ mode: 'manual', proxyUrl: `http://127.0.0.1:${address.port}` }, {}, {})
  const dispatcher = createProxyDispatcher(resolved)
  try {
    const response = await fetch('http://provider.invalid/test', { dispatcher })
    assert.equal(await response.text(), 'through proxy')
    assert.equal(seenUrl, 'http://provider.invalid/test')
  } finally {
    await dispatcher.close()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
