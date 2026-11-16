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
import { openForward, type Forward } from './remote/forward.js'
import {
  liveSshRunner,
  resolveRemoteHost,
  type SshRunner,
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
  const exchange = await exchangeConnection({
    baseUrl: record.descriptor.httpUrl,
    token: record.descriptor.token,
    interactions: 'answer',
  })
  return {
    record,
    cookie: exchange.cookie,
    baseUrl: record.descriptor.httpUrl,
    muxUrl: exchange.muxUrl,
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

/** What the Host behind an attachment answers about itself. */
export interface ForwardedHealth {
  readonly instanceId: string
  readonly version: string
  readonly state: string
}

/**
 * Ask the Host behind an attachment's origin what it is.
 *
 * A remote window's forward can start answering for a *different* daemon than
 * the one this process attached to — an update, a `host restart` and a reboot
 * each mint a new endpoint token and possibly a new port. That is the one drop a
 * live transport cannot repair, and it is invisible from the outside: the port
 * answers either way. The short timeout is deliberate, because a recovery probe
 * runs while the window is disconnected and must not become another thing that
 * hangs.
 * @param baseUrl - the attachment's forwarded origin.
 * @returns the daemon's own facts, or undefined when nothing answers in time.
 */
export async function probeForwardedHost(baseUrl: string): Promise<ForwardedHealth | undefined> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) return undefined
    const value = await response.json() as { instanceId?: unknown; version?: unknown; runtime?: { state?: unknown } }
    if (typeof value.instanceId !== 'string' || typeof value.version !== 'string') return undefined
    return {
      instanceId: value.instanceId,
      version: value.version,
      state: typeof value.runtime?.state === 'string' ? value.runtime.state : 'unknown',
    }
  } catch {
    return undefined
  }
}

/** A remote Host this client reached over the user's own SSH. */
export interface RemoteAttachment extends HostAttachment {
  /**
   * The forward carrying this attachment, rebuilt by the client after any drop.
   *
   * It keeps one local port for its whole life: the `/connect` cookie obtained
   * below is bound to that origin, so a forward that comes back on the same port
   * is what lets the transport reconnect without a new process.
   */
  readonly forward: Forward
  /** The ssh destination the user picked. */
  readonly alias: string
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

/** What one `/connect` exchange yields. */
export interface ConnectionExchange {
  /** `Cookie:` header value the Host signed for this origin. */
  readonly cookie: string
  /** Absolute mux WebSocket URL, resolved against the forwarded origin. */
  readonly muxUrl: string
}

/**
 * Exchange a launch token for an API cookie on one origin.
 *
 * A cookie is not a durable credential: it carries the id of the Peer the Host
 * published for it, and that Peer is disposed with the socket that owned it. Any
 * dropped socket therefore invalidates the cookie, and every later request on the
 * same origin answers 401 — which is why a reconnecting client has to exchange
 * the token again rather than retry with what it holds. The token itself belongs
 * to the daemon process and survives this, so the exchange is all that is needed.
 * @param options - the origin being spoken to, the launch token, and the
 *   forwarded-event participation this client wants.
 * @returns the cookie plus the mux URL that origin advertises.
 * @throws when the Host refuses the exchange or returns no cookie.
 */
export async function exchangeConnection(options: {
  readonly baseUrl: string
  readonly token: string
  readonly interactions: 'answer' | 'none'
}): Promise<ConnectionExchange> {
  const response = await fetch(
    `${options.baseUrl}/connect?token=${encodeURIComponent(options.token)}&interactions=${options.interactions}`,
    { redirect: 'manual' },
  )
  if (response.status !== 302) throw new Error(`the Host refused the connection exchange (${String(response.status)})`)
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  if (cookie === undefined) throw new Error('the Host did not return an API cookie')
  // The redirect names the Host's own origin, which is on the other side of the
  // forward: only its path is kept, or the mux would try to reach a port this
  // machine does not serve. `/connect` answers with a **relative** location
  // (`./api/remote.mux`), so it is resolved against the forwarded origin rather
  // than parsed on its own — `new URL('./api/remote.mux')` throws "Invalid URL".
  const location = response.headers.get('location')
  const path = (() => {
    if (location === null || location === '') return '/api/remote.mux'
    try {
      return new URL(location, `${options.baseUrl}/`).pathname
    } catch {
      return '/api/remote.mux'
    }
  })()
  return { cookie, muxUrl: `${options.baseUrl.replace(/^http/u, 'ws')}${path}` }
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
  // A stopped Host is started so its version can be read: starting is not the
  // answer yet, because the release installed there has to agree with this one.
  const { probe, verdict } = await resolveRemoteHost(alias, run, {
    version: VERSION,
    protocol: HOST_DAEMON_PROTOCOL,
  })
  // Still not running: attaching anyway would forward to a port nobody serves.
  if (verdict === 'start') throw new Error(`${alias}: the Host did not stay up`)
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

  // The forward keeps its local port for its whole life, revivals included: the
  // `/connect` cookie below is bound to this origin, so a port that changed under
  // the transport would mean a background process instead of a live window.
  // `freePort` asks the OS for a port and then lets it go, so another process can
  // take it before ssh binds it — `ExitOnForwardFailure=yes` and a fresh port
  // inside `openForward` are what turn that race into one retried attempt.
  const forward = await openForward({
    alias,
    remotePort,
    ...(options.spawner === undefined ? {} : { spawner: options.spawner }),
  })
  const baseUrl = `http://127.0.0.1:${String(forward.port)}`
  // A forward is a child process with no stdio to notice its parent leaving, so
  // the process itself has to end it: a normal exit, and the two signals a
  // window can receive from a terminal or a supervisor. Without this a killed
  // client leaves an ssh holding a port on both ends.
  const endTunnel = (): void => { forward.close() }
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
    const { cookie, muxUrl } = await exchangeConnection({
      baseUrl,
      token: endpoint.descriptor.token,
      interactions: 'answer',
    })
    return {
      // The descriptor is rewritten to the forwarded origin: everything above
      // this line speaks to `127.0.0.1:<localPort>`, exactly like a local Host.
      record: { ...endpoint, descriptor: { ...endpoint.descriptor, httpUrl: baseUrl } } as HostEndpointRecord,
      cookie,
      baseUrl,
      muxUrl,
      forward,
      alias,
    }
  } catch (error) {
    forward.close()
    throw error
  }
}
