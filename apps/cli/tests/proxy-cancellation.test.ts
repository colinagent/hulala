import assert from 'node:assert/strict'
import { createServer, request, type Server } from 'node:http'
import test from 'node:test'
import { proxyRequest } from '../src/launcher.js'

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return address.port
}

test('disconnecting a browser cancels a pending Host request without breaking the proxy', { timeout: 5000 }, async () => {
  let received!: () => void, disconnected!: () => void
  const ready = new Promise<void>(resolve => { received = resolve })
  const closed = new Promise<void>(resolve => { disconnected = resolve })
  const host = createServer((input, output) => {
    if (input.url === '/health') { output.end('ready'); return }
    input.resume()
    input.on('end', received)
    output.on('close', disconnected)
    // Model a native dialog: the request body has arrived but no reply is ready.
  })
  const hostPort = await listen(host)
  const gateway = createServer((input, output) => proxyRequest(input, output, { host: '127.0.0.1', port: hostPort }))
  const port = await listen(gateway)
  const client = request({ hostname: '127.0.0.1', port, path: '/dialog', method: 'POST' })
  client.on('error', () => {})
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    client.end('{}')
    await ready
    client.destroy()
    await Promise.race([closed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Host request was left running')), 1500) })])
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(await response.text(), 'ready')
  } finally {
    clearTimeout(timeout); client.destroy()
    gateway.closeAllConnections(); host.closeAllConnections()
    await Promise.all([gateway, host].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  }
})
