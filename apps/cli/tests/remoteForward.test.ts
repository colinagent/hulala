/**
 * The forward a remote window lives on.
 *
 * An ssh forward dies for ordinary reasons — a sleeping laptop, a network that
 * roamed, a machine that rebooted — and every one of them used to leave the
 * client retrying a closed loopback port until the user ran `/restart`. These
 * cases pin the replacement: the revival happens without being asked, on the
 * port the transport above is already addressing, and it reports both phases.
 */
import { expect, test } from 'bun:test'
import { createServer, type Server } from 'node:net'
import { openForward } from '../src/remote/forward.js'
import type { TunnelSpawner } from '../src/remote/ssh.js'

/** One spawned ssh: a real listener on the forwarded port, killed on demand. */
interface SpawnedSsh {
  readonly port: number
  readonly server: Server
  readonly kill: () => void
  readonly exit: () => void
}

/** A spawner that forwards for real and can be killed like an ssh that died. */
function spawner(): { spawner: TunnelSpawner; spawned: SpawnedSsh[] } {
  const spawned: SpawnedSsh[] = []
  const tunnelSpawner: TunnelSpawner = args => {
    const forward = args[args.indexOf('-L') + 1] ?? ''
    const port = Number(forward.split(':')[1])
    const server = createServer()
    server.listen(port, '127.0.0.1')
    const handlers: Array<(code: number | null) => void> = []
    const exit = (): void => {
      server.close()
      for (const handler of handlers.splice(0)) handler(1)
    }
    spawned.push({ port, server, kill: () => { server.close() }, exit })
    return {
      kill: () => { server.close() },
      onExit: handler => { handlers.push(handler) },
    }
  }
  return { spawner: tunnelSpawner, spawned }
}

async function freePort(): Promise<number> {
  const reservation = createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const address = reservation.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  return address.port
}

/** Wait until the predicate holds; the revival is asynchronous by design. */
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('a forward that comes back keeps the port the transport already addresses', async () => {
  const fake = spawner()
  const port = await freePort()
  const forward = await openForward({
    alias: 'devbox',
    remotePort: 5000,
    localPort: port,
    spawner: fake.spawner,
    retry: { firstMs: 10, maxMs: 40 },
  })
  try {
    const phases: string[] = []
    forward.onState(state => { phases.push(state) })
    expect(forward.port).toBe(port)
    expect(forward.state()).toBe('forwarding')

    // The ssh dies the way a sleeping laptop's does.
    fake.spawned[0]?.exit()

    // The port is the whole promise: the `/connect` cookie is bound to this
    // origin, so a revival on another port would need a new process.
    await waitFor(() => forward.state() === 'forwarding', 'the revived forward')
    expect(phases).toEqual(['reviving', 'forwarding'])
    expect(fake.spawned.length).toBeGreaterThanOrEqual(2)
    expect(fake.spawned.every(entry => entry.port === port)).toBe(true)
  } finally {
    forward.close()
  }
})

test('a forward that stops while it is unreachable is reported, not retried forever', async () => {
  const fake = spawner()
  const port = await freePort()
  const forward = await openForward({
    alias: 'devbox',
    remotePort: 5000,
    localPort: port,
    spawner: fake.spawner,
    retry: { firstMs: 10, maxMs: 20 },
  })
  const phases: string[] = []
  forward.onState(state => { phases.push(state) })
  fake.spawned[0]?.exit()
  await waitFor(() => forward.state() === 'reviving', 'the reviving phase')
  forward.close()
  const spawnedAfterClose = fake.spawned.length
  phases.length = 0
  // A closed forward must not resurrect itself: the window that owned it is gone.
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(fake.spawned.length).toBe(spawnedAfterClose)
  expect(phases).toEqual([])
  expect(forward.state()).toBe('reviving')
})

test('an unsuccessful revival keeps trying, and a later one succeeds', async () => {
  const fake = spawner()
  const port = await freePort()
  let attempts = 0
  /** The first connection must succeed; every revival fails until `mode` flips. */
  let mode: 'connect' | 'refuse' = 'connect'
  const forward = await openForward({
    alias: 'devbox',
    remotePort: 5000,
    localPort: port,
    spawner: args => {
      attempts += 1
      if (mode === 'connect') return fake.spawner(args)
      // An unreachable machine: the attempt binds nothing and exits at once.
      return { kill: () => undefined, onExit: handler => { queueMicrotask(() => handler(255)) } }
    },
    retry: { firstMs: 5, maxMs: 15 },
  })
  try {
    mode = 'refuse'
    fake.spawned[0]?.exit()
    await waitFor(() => attempts >= 3, 'a few failed attempts', 5_000)
    expect(forward.state()).toBe('reviving')
    mode = 'connect'
    await waitFor(() => forward.state() === 'forwarding', 'the successful revival')
    expect(fake.spawned.at(-1)?.port).toBe(port)
  } finally {
    forward.close()
  }
})
