/**
 * Attach the terminal client to this machine's Hulala Host.
 *
 * The Host is shared by every client and owns the daemon lifecycle; this module
 * finds its endpoint, starts a detached Host only when nothing answers, and
 * exchanges the launch token for the DSH API cookie that later Remote calls and
 * the mux WebSocket carry.
 *
 * @module hulala-cli/host-attach
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HOST_DAEMON_PROTOCOL,
  discoverHostDaemon,
  ensureHostDaemon,
  resolveHostDaemonPaths,
  stopHostDaemon,
  type Health,
  type HostEndpointRecord,
} from '@hulala/host-client/node'
import { VERSION } from './constants.js'
import {
  liveSshRunner,
  openTunnel,
  probeHost,
  startRemoteHost,
  verdictOf,
  type SshRunner,
  type Tunnel,
  type TunnelSpawner,
} from './remote/ssh.js'
import { resolvePaths } from './paths.js'
import { appendPathEntry, ripgrepPathEntry } from '@hulala/editor-home'

/** One attached Host, ready for DSH Remote calls. */
export interface HostAttachment {
  /** Published endpoint facts: port, instance, protocol, pid. */
  readonly record: HostEndpointRecord
  /** `Cookie:` value signed by the Host for API callers. */
  readonly cookie: string
  /** Host API origin. */
  readonly baseUrl: string
  /** Mux WebSocket URL used for streams and forwarded events. */
  readonly muxUrl: string
}

/** Daemon files for the CLI's state root. */
function daemonRoots(paths = resolvePaths()): { server: string, logs: string } {
  return { server: join(paths.data, 'server'), logs: paths.logs }
}

/** Packaged release root: `bin/hulala` + `server/hulala-host.mjs` + `runtime/`. */
function packageRoot(): string | undefined {
  const configured = process.env.HULALA_PACKAGE_ROOT?.trim()
  if (configured !== undefined && configured !== '') return configured
  const here = dirname(fileURLToPath(import.meta.url))
  for (const candidate of [join(here, '..'), join(here, '..', '..')]) {
    if (existsSync(join(candidate, 'server', 'hulala-host.mjs'))) return candidate
  }
  return undefined
}

/** Node executable the Host runs on; packaged installs use their bundled Node when present. */
function nodeExecutable(): string {
  const configured = process.env.HULALA_NODE_EXECUTABLE?.trim()
  if (configured !== undefined && configured !== '') return configured
  const root = packageRoot()
  if (root !== undefined) {
    const bundled = join(root, 'runtime', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
    if (existsSync(bundled)) return bundled
  }
  return 'node'
}

/** Packaged Host wrapper, or the built Host in a source checkout. */
function hostEntry(): string {
  const root = packageRoot()
  if (root !== undefined) return join(root, 'server', 'hulala-host.mjs')
  const repositoryRoot = process.env.HULALA_REPOSITORY_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url))
  return join(repositoryRoot, 'apps', 'server', 'dist', 'hulala-desktop-server.mjs')
}

/**
 * Attach to the Host, starting a detached daemon when none answers.
 *
 * A client never replaces a live Host: if the daemon answers with another
 * product version, the user updated another installation (or started another
 * product sharing this state root), and pulling the daemon to this process's
 * version would drop every other window in a loop. Attaching is refused with an
 * actionable error instead; only `hulala update` and `hulala host stop`
 * replace a daemon.
 * @returns the endpoint plus the API cookie the Host issued.
 */
export async function attachHost(): Promise<HostAttachment> {
  const paths = resolvePaths()
  // The editor pickers already run the shipped `rg`; give the Host the same
  // binary so the model's `bash` calls do not depend on the machine either.
  const ripgrepPath = appendPathEntry(process.env.PATH, ripgrepPathEntry(paths.data, { packageRoot: packageRoot() }))
  const { record } = await ensureHostDaemon({
    paths: daemonRoots(paths),
    version: VERSION,
    replaceStale: false,
    spawn: {
      command: nodeExecutable(),
      args: ['--experimental-sqlite', hostEntry(), '--daemon', '--hulala-home', paths.data, '--port', '0'],
      env: { HULALA_VERSION: VERSION, ...(ripgrepPath === undefined ? {} : { PATH: ripgrepPath }) },
    },
  })
  const exchange = await fetch(
    `${record.descriptor.httpUrl}/connect?token=${encodeURIComponent(record.descriptor.token)}&interactions=answer`,
    { redirect: 'manual' },
  )
  if (exchange.status !== 302) throw new Error(`Hulala Host refused the connection exchange (${exchange.status})`)
  const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
  if (!cookie) throw new Error('Hulala Host did not return an API cookie')
  const location = exchange.headers.get('location')
  return {
    record,
    cookie,
    baseUrl: record.descriptor.httpUrl,
    muxUrl: location !== null && location.startsWith('ws') ? location : `${record.descriptor.httpUrl.replace(/^http/, 'ws')}/api/remote.mux`,
  }
}

/** Read-only daemon state for `hulala host status`; never starts a Host. */
export type HostInspection =
  | { state: 'stopped' }
  | { state: 'running'; record: HostEndpointRecord; health: Health }
  | { state: 'unresponsive'; record: HostEndpointRecord }
  | { state: 'incompatible'; record: HostEndpointRecord }

/** Inspect the Host for this state root without spawning or stopping anything. */
export async function inspectHost(): Promise<HostInspection> {
  const files = resolveHostDaemonPaths(daemonRoots())
  const discovery = await discoverHostDaemon(files)
  switch (discovery.status) {
    case 'ready': return { state: 'running', record: discovery.record, health: discovery.health }
    case 'unhealthy': return { state: 'unresponsive', record: discovery.record }
    case 'incompatible': return { state: 'incompatible', record: discovery.record }
    default: return { state: 'stopped' }
  }
}

/** Stop this machine's Host; only an explicit user action calls this. */
export async function stopHost(): Promise<'absent' | 'stopped'> {
  return stopHostDaemon(daemonRoots())
}

/** A remote Host this client reached over the user's own SSH. */
export interface RemoteAttachment extends HostAttachment {
  /** The ssh forward carrying this attachment; the caller owns its lifetime. */
  readonly tunnel: Tunnel
  /** The ssh destination the user picked. */
  readonly alias: string
}

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

/** What the remote endpoint record holds; the token never leaves this process. */
interface RemoteEndpointRecord {
  readonly descriptor: {
    readonly httpUrl: string
    readonly token: string
    readonly instanceId: string
    readonly eventsUrl: string
    readonly authCookieName?: string
  }
  readonly protocol?: number
  readonly version?: string
  readonly pid?: number
}

/**
 * Attach to a Host on another machine.
 *
 * The remote state root's endpoint record is read over the user's own ssh — the
 * same access their login shell has — and only the launch token crosses to this
 * process. Nothing else about the remote machine is trusted or copied: the
 * tunnel forwards one loopback port, and the Host keeps binding loopback as it
 * always did.
 * @param alias - the ssh destination the user picked.
 * @param options - injected runner and tunnel spawner, for tests.
 * @returns the attachment plus the tunnel that carries it.
 * @throws when the machine is unreachable, has no compatible Host, or the
 *   forward cannot be opened.
 */
export async function attachRemote(alias: string, options: {
  runner?: SshRunner
  spawner?: TunnelSpawner
} = {}): Promise<RemoteAttachment> {
  const run = options.runner ?? liveSshRunner()
  const probe = await probeHost(alias, run)
  const verdict = verdictOf(probe, { version: VERSION, protocol: HOST_DAEMON_PROTOCOL })
  if (verdict === 'unreachable' || verdict === 'install') {
    const reason = probe.state === 'unreachable' ? probe.reason : 'no Hulala Host is installed there'
    throw new Error(`${alias}: ${reason}`)
  }
  if (verdict === 'client-update') {
    throw new Error(`${alias} runs a newer Hulala than this client; update this installation first`)
  }
  if (verdict === 'update') {
    throw new Error(`${alias} runs an older Hulala; accept its update before attaching`)
  }
  if (verdict === 'start' && !await startRemoteHost(alias, run)) {
    throw new Error(`${alias}: the Host did not start`)
  }

  // The record names the port the Host actually bound; the token is a secret the
  // user's own shell can read, so ssh is the channel rather than `host status`.
  const recordResult = await run(alias, 'cat "$HOME/.hulala/server/host/endpoint.json"')
  if (recordResult.code !== 0) throw new Error(`${alias}: cannot read the Host endpoint (${recordResult.stderr.trim()})`)
  let endpoint: RemoteEndpointRecord
  try {
    endpoint = JSON.parse(recordResult.stdout) as RemoteEndpointRecord
  } catch {
    throw new Error(`${alias}: the Host endpoint record is not readable JSON`)
  }
  const remotePort = Number(new URL(endpoint.descriptor.httpUrl).port)
  if (!Number.isInteger(remotePort) || remotePort <= 0) throw new Error(`${alias}: the Host endpoint has no port`)

  const localPort = await freePort()
  const tunnel = await openTunnel({ alias, localPort, remotePort }, options.spawner)
  const baseUrl = `http://127.0.0.1:${String(localPort)}`
  // A forward is a child process with no stdio to notice its parent leaving, so
  // the process itself has to end it: a normal exit, and the two signals a
  // window can receive from a terminal or a supervisor. Without this a killed
  // client leaves an ssh holding a port on both ends.
  const endTunnel = (): void => { tunnel.close() }
  process.once('exit', endTunnel)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      endTunnel()
      // Re-raise with the default action: the client's own exit path already
      // restored the terminal, and swallowing the signal would hide the cause.
      process.removeListener('exit', endTunnel)
      process.kill(process.pid, signal)
    })
  }
  try {
    const exchange = await fetch(
      `${baseUrl}/connect?token=${encodeURIComponent(endpoint.descriptor.token)}&interactions=answer`,
      { redirect: 'manual' },
    )
    if (exchange.status !== 302) throw new Error(`the remote Host refused the connection exchange (${String(exchange.status)})`)
    const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
    if (cookie === undefined) throw new Error('the remote Host did not return an API cookie')
    // The redirect names the Host's own origin, which is on the other side of
    // the tunnel: only its path is kept, or the mux would try to reach a port
    // this machine does not serve. `/connect` answers with a **relative** location
    // (`./api/remote.mux`), so it is resolved against the forwarded origin rather
    // than parsed on its own — `new URL('./api/remote.mux')` throws "Invalid URL".
    const location = exchange.headers.get('location')
    const muxPath = (() => {
      if (location === null || location === '') return '/api/remote.mux'
      try {
        return new URL(location, `${baseUrl}/`).pathname
      } catch {
        return '/api/remote.mux'
      }
    })()
    return {
      // The descriptor is rewritten to the forwarded origin: everything above
      // this line speaks to `127.0.0.1:<localPort>`, exactly like a local Host.
      record: { ...endpoint, descriptor: { ...endpoint.descriptor, httpUrl: baseUrl } } as HostEndpointRecord,
      cookie,
      baseUrl,
      muxUrl: `${baseUrl.replace(/^http/u, 'ws')}${muxPath}`,
      tunnel,
      alias,
    }
  } catch (error) {
    tunnel.close()
    throw error
  }
}
