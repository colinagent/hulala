/**
 * Attaching to a Host on another machine.
 *
 * A local HTTP server stands in for the remote Host and a TCP proxy stands in for
 * the ssh forward, so this pins the whole path a real remote takes: what the
 * probe is asked, which record is read, how the origin is rewritten, and that the
 * tunnel is closed when the exchange fails.
 */
import { expect, test } from 'bun:test'
import { createServer, connect as connectTo } from 'node:net'
import { attachRemote } from '../src/hostAttach.js'
import { HOST_DAEMON_PROTOCOL } from '@hulala/host-client/node'
import { VERSION } from '../src/constants.js'
import type { SshRunner, TunnelSpawner } from '../src/remote/ssh.js'

/** A remote Host: answers `/connect` with a cookie and a mux location. */
function fakeHost(options: { status?: number } = {}): { port: number, url: string, requests: string[], stop(): void } {
  const requests: string[] = []
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    port: 0,
    fetch(request): Response {
      const url = new URL(request.url)
      requests.push(url.pathname + url.search)
      if (url.pathname !== '/connect') return new Response('not found', { status: 404 })
      if (options.status !== undefined) return new Response(null, { status: options.status })
      return new Response(null, {
        status: 302,
        headers: {
          'set-cookie': 'hulala_test=secret; Path=/; HttpOnly',
          // Exactly what `dsh-client-connection` writes: a relative location, not
          // an absolute ws URL. A fake that returned the nicer form hid a crash.
          location: './api/remote.mux',
        },
      })
    },
  })
  return {
    port: server.port ?? 0,
    url: `http://127.0.0.1:${String(server.port)}`,
    requests,
    stop: () => { void server.stop(true) },
  }
}

/** A forward that really moves bytes: local port → the fake Host. */
function proxyTo(remotePort: number): { spawner: TunnelSpawner; closed: () => number } {
  let closed = 0
  const spawner: TunnelSpawner = args => {
    const forward = args[args.indexOf('-L') + 1] ?? ''
    const localPort = Number(forward.split(':')[1])
    const server = createServer(socket => {
      const upstream = connectTo(remotePort, '127.0.0.1')
      socket.pipe(upstream).pipe(socket)
      server.once('close', () => upstream.destroy())
      socket.once('error', () => upstream.destroy())
    })
    server.listen(localPort, '127.0.0.1')
    return {
      kill: () => { closed += 1; server.close() },
      onExit: () => undefined,
    }
  }
  return { spawner, closed: () => closed }
}

const endpoint = (url: string): string => JSON.stringify({
  descriptor: { httpUrl: url, token: 't'.repeat(40), instanceId: 'instance-1', eventsUrl: `${url.replace('http', 'ws')}/api/remote.mux` },
  protocol: HOST_DAEMON_PROTOCOL,
  version: VERSION,
  pid: 99,
})

/** The commands a probe and an attach run, in order. */
function runnerFor(host: ReturnType<typeof fakeHost>, overrides: Partial<Record<'status' | 'cat', string>> = {}): { run: SshRunner; commands: string[] } {
  const commands: string[] = []
  return {
    commands,
    run: async (_alias, command) => {
      commands.push(command)
      if (command.includes('host status')) {
        return { code: 0, stdout: overrides.status ?? JSON.stringify({ state: 'running', version: VERSION, protocol: HOST_DAEMON_PROTOCOL, httpUrl: host.url }), stderr: '' }
      }
      if (command.includes('endpoint.json')) return { code: 0, stdout: overrides.cat ?? endpoint(host.url), stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    },
  }
}

test('a remote attach reads the record over ssh and speaks to the forwarded origin', async () => {
  const host = fakeHost()
  const { run, commands } = runnerFor(host)
  const tunnel = proxyTo(host.port)
  try {
    const attached = await attachRemote('devbox', { runner: run, spawner: tunnel.spawner })
    expect(attached.alias).toBe('devbox')
    expect(attached.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
    expect(attached.baseUrl).not.toBe(host.url)
    expect(attached.cookie).toBe('hulala_test=secret')
    expect(attached.muxUrl).toBe(`${attached.baseUrl.replace('http', 'ws')}/api/remote.mux`)
    // The record is rewritten, so nothing above this line can reach the wrong port.
    expect(attached.record.descriptor.httpUrl).toBe(attached.baseUrl)
    expect(attached.record.descriptor.token).toBe('t'.repeat(40))
    expect(commands.some(command => command.includes('host status'))).toBe(true)
    expect(commands.some(command => command.includes('endpoint.json'))).toBe(true)
    expect(host.requests[0]).toContain('/connect?token=')
    attached.tunnel.close()
  } finally {
    host.stop()
  }
})

test('a refused exchange closes the tunnel instead of leaking a forward', async () => {
  const host = fakeHost({ status: 403 })
  const { run } = runnerFor(host)
  const tunnel = proxyTo(host.port)
  try {
    await expect(attachRemote('devbox', { runner: run, spawner: tunnel.spawner })).rejects.toThrow('refused the connection exchange')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(tunnel.closed()).toBe(1)
  } finally {
    host.stop()
  }
})

test('an older Host is refused before any tunnel is opened', async () => {
  const host = fakeHost()
  const runner = runnerFor(host, {
    status: JSON.stringify({ state: 'running', version: '0.0.1', protocol: HOST_DAEMON_PROTOCOL, httpUrl: host.url }),
  })
  try {
    await expect(attachRemote('devbox', { runner: runner.run, spawner: proxyTo(host.port).spawner }))
      .rejects.toThrow('accept its update')
  } finally {
    host.stop()
  }
})

test('a machine with no Host installed is refused, and nothing is started', async () => {
  const commands: string[] = []
  const run: SshRunner = async (_alias, command) => {
    commands.push(command)
    return command.includes('host status')
      ? { code: 0, stdout: '{"state":"uninstalled"}', stderr: '' }
      : { code: 0, stdout: '', stderr: '' }
  }
  await expect(attachRemote('devbox', { runner: run })).rejects.toThrow('no Hulala Host is installed')
  expect(commands.some(command => command.includes('host start'))).toBe(false)
})

test('a stopped Host is started once, then attached', async () => {
  const host = fakeHost()
  const started: string[] = []
  const runner = runnerFor(host, {
    status: JSON.stringify({ state: 'stopped', version: VERSION, protocol: HOST_DAEMON_PROTOCOL }),
  })
  const run: SshRunner = async (alias, command) => {
    if (command.includes('host start')) {
      started.push(command)
      return { code: 0, stdout: '', stderr: '' }
    }
    return runner.run(alias, command)
  }
  const tunnel = proxyTo(host.port)
  try {
    const attached = await attachRemote('devbox', { runner: run, spawner: tunnel.spawner })
    expect(started).toHaveLength(1)
    expect(attached.baseUrl).toContain('127.0.0.1')
    attached.tunnel.close()
  } finally {
    host.stop()
  }
})

test('a signalled client ends its forward before it goes', async () => {
  // The forward is a child with no stdio, so nothing notices the parent leaving.
  // `attachRemote` registers the cleanup, and re-raising the signal keeps the
  // client's own exit path (terminal restore) in charge.
  const host = fakeHost()
  const { run } = runnerFor(host)
  const tunnel = proxyTo(host.port)
  const attached = await attachRemote('devbox', { runner: run, spawner: tunnel.spawner })
  const listeners = { exit: process.listenerCount('exit'), int: process.listenerCount('SIGINT') }
  expect(listeners.exit).toBeGreaterThan(0)
  expect(listeners.int).toBeGreaterThan(0)
  // Simulate the normal exit path: the registered listener must close the forward.
  process.emit('exit', 0)
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(tunnel.closed()).toBe(1)
  attached.tunnel.close()
  host.stop()
})

test('an absolute ws location keeps only its path, and a missing one falls back', async () => {
  // The two shapes a Host (or a proxy in front of it) can answer with. Only the
  // path may survive: the authority belongs to the tunnel, not to the far side.
  for (const location of ['ws://127.0.0.1:1/api/remote.mux', undefined]) {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(): Response {
        requests.push('connect')
        return new Response(null, {
          status: 302,
          headers: {
            'set-cookie': 'hulala_test=x; Path=/',
            ...(location === undefined ? {} : { location }),
          },
        })
      },
    })
    const host = { port: server.port ?? 0, url: `http://127.0.0.1:${String(server.port)}` }
    const run: SshRunner = async (_alias, command) => command.includes('host status')
      ? { code: 0, stdout: JSON.stringify({ state: 'running', version: VERSION, protocol: HOST_DAEMON_PROTOCOL, httpUrl: host.url }), stderr: '' }
      : { code: 0, stdout: endpoint(host.url), stderr: '' }
    const tunnel = proxyTo(host.port)
    try {
      const attached = await attachRemote('devbox', { runner: run, spawner: tunnel.spawner })
      expect(attached.muxUrl).toBe(`${attached.baseUrl.replace('http', 'ws')}/api/remote.mux`)
      attached.tunnel.close()
    } finally {
      server.stop(true)
    }
  }
})
