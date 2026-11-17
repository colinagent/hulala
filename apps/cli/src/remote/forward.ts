/**
 * The forward a remote window lives on, kept alive.
 *
 * An ssh forward is the only physical link between this client and a Host on
 * another machine, and it dies for ordinary reasons: the laptop slept, the Wi-Fi
 * roamed, the far side rebooted, the keepalive found a half-open socket. Nothing
 * above it can tell those apart from a Host that stopped answering — every one of
 * them looks like a refused loopback port.
 *
 * So the forward is rebuilt here, on **the same local port**. That is the whole
 * trick: the transport above addresses `127.0.0.1:<port>`, and the `/connect`
 * cookie is bound to that origin, so a forward that comes back on the same port
 * needs no new window — the transport retries, the token is exchanged again (a
 * cookie dies with the socket that owned its Peer), and the client keeps its
 * transcript.
 *
 * Nothing else can take that port either: the only process that held it is the
 * ssh that just died, and a listener is not kept alive by its former
 * connections.
 *
 * @module hulala-cli/remote/forward
 */
import { spawnTunnel, openTunnel, type Tunnel, type TunnelSpawner } from './ssh.js'

/** Whether the forward is carrying traffic, or being rebuilt after a loss. */
export type ForwardState = 'forwarding' | 'reviving'

/** One loopback forward that outlives a dropped ssh. */
export interface Forward {
  /** Local port the Host is reachable on. Stable for the forward's whole life. */
  readonly port: number
  /**
   * Loopback port this forward hands to on the far machine.
   *
   * It is the port the Host bound when this window attached, and a Host that
   * restarts elsewhere binds a different one — the fact recovery compares the
   * machine's own answer against, because the local port never changes.
   */
  readonly remotePort: number
  /** Current phase, readable at any time by a panel or a recovery probe. */
  state(): ForwardState
  /**
   * Subscribe to phase changes.
   * @param handler - called with the new phase, never with the current one.
   * @returns the unsubscribe.
   */
  onState(handler: (state: ForwardState) => void): () => void
  /** Stop the forward and stop rebuilding it. Idempotent. */
  close(): void
}

/** What one forward needs to know. */
export interface ForwardOptions {
  /** The ssh destination the user picked. */
  readonly alias: string
  /** The remote Host's loopback port, from its own endpoint record. */
  readonly remotePort: number
  /**
   * Local port to use. Absent asks the OS once and keeps that port for every
   * revival; supplied when the caller already owns a port it must keep.
   */
  readonly localPort?: number
  /** Injected spawner; tests stand in a local forwarder. */
  readonly spawner?: TunnelSpawner
  /** Revival backoff: the first delay and the ceiling it grows to. */
  readonly retry?: { readonly firstMs: number; readonly maxMs: number }
}

/** Default revival backoff: quick first try, patient ceiling. */
const FIRST_RETRY_MS = 500
const MAX_RETRY_MS = 10_000

/** Ask the operating system for a free loopback port. */
async function freePort(): Promise<number> {
  const { createServer } = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('could not reserve a loopback port')))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

/**
 * Open one forward and keep rebuilding it after the ssh carrying it dies.
 *
 * The first connection must succeed — a machine that cannot be reached at all is
 * the caller's error to report, not something to wait out — while every later
 * loss is absorbed: the phase drops to `reviving`, revivals retry with backoff on
 * one unchanging port, and the phase returns to `forwarding` once ssh is up again.
 * @param options - machine, ports, spawner and backoff.
 * @returns the forward, already carrying traffic.
 * @throws when the forward never came up, with ssh's own failure as the cause.
 */
export async function openForward(options: ForwardOptions): Promise<Forward> {
  const spawner = options.spawner ?? spawnTunnel
  const firstMs = options.retry?.firstMs ?? FIRST_RETRY_MS
  const maxMs = options.retry?.maxMs ?? MAX_RETRY_MS
  const listeners = new Set<(state: ForwardState) => void>()

  let port: number | undefined = options.localPort
  let current: Tunnel | undefined
  let phase: ForwardState = 'forwarding'
  let failures = 0
  let closing = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const emit = (next: ForwardState): void => {
    if (phase === next || closing) return
    phase = next
    for (const listener of [...listeners]) {
      try {
        listener(next)
      } catch {
        // A listener that throws must not stop the revival that told it.
      }
    }
  }

  const connect = (localPort: number): Promise<Tunnel> =>
    openTunnel({ alias: options.alias, localPort, remotePort: options.remotePort }, spawner)

  const watch = (tunnel: Tunnel): void => {
    tunnel.onExit(() => {
      if (closing) return
      // The transport above sees a refused port and starts its own retries; this
      // is the moment the reason for them can be fixed.
      emit('reviving')
      schedule()
    })
  }

  const attempt = async (): Promise<void> => {
    if (closing || port === undefined) return
    try {
      const tunnel = await connect(port)
      if (closing) {
        tunnel.close()
        return
      }
      current = tunnel
      failures = 0
      watch(tunnel)
      emit('forwarding')
    } catch {
      // Still unreachable: the port stays reserved for the next try, because the
      // cookie above it is bound to this origin.
      failures += 1
      schedule()
    }
  }

  const schedule = (): void => {
    if (closing || timer !== undefined) return
    const cap = Math.min(maxMs, firstMs * 2 ** Math.min(failures, 16))
    // A little jitter keeps several windows on one machine from retrying in
    // lockstep after a shared network outage.
    const delay = Math.round(cap * (0.75 + Math.random() * 0.5))
    timer = setTimeout(() => {
      timer = undefined
      void attempt()
    }, delay)
    // A forward must never be the reason a process that wants to exit stays up.
    timer.unref?.()
  }

  // The OS-reserved port can be taken between the reservation and ssh binding it,
  // and `ExitOnForwardFailure` turns that race into an immediate failure. Only a
  // port this module chose itself may be replaced: a caller that named one is
  // asking for that origin specifically.
  for (let tries = 0; current === undefined; tries += 1) {
    const candidate = port ?? await freePort()
    try {
      const tunnel = await connect(candidate)
      port = candidate
      current = tunnel
      watch(tunnel)
    } catch (error) {
      if (port !== undefined || tries >= 2) {
        throw error instanceof Error
          ? error
          : new Error(`ssh could not forward a loopback port from ${options.alias}`)
      }
    }
  }
  if (port === undefined) throw new Error(`ssh could not forward a loopback port from ${options.alias}`)

  return {
    port,
    remotePort: options.remotePort,
    state: () => phase,
    onState(handler) {
      listeners.add(handler)
      return () => { listeners.delete(handler) }
    },
    close() {
      if (closing) return
      closing = true
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      listeners.clear()
      current?.close()
      current = undefined
    },
  }
}
