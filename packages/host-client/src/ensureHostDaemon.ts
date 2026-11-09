/**
 * Filesystem-backed Host discovery for Node processes.
 *
 * Desktop, the terminal client and the CLI all reach the same long-lived Host
 * through these helpers: find the daemon that owns a state root, start one when
 * nobody answers, and stop it only when the user asks.
 *
 * @module @hulala/host-client/node
 */
import { spawn } from 'node:child_process'
import { mkdir, open, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { HOST_DAEMON_PROTOCOL, type Health } from './protocol.js'
import {
  discoverHostDaemon,
  probeHostEndpoint,
  readHostEndpoint,
  resolveHostDaemonPaths,
  type HostDaemonDiscovery,
  type HostDaemonPaths,
  type HostDaemonRoots,
  type HostEndpointRecord,
} from './discovery.js'

/** Everything a detached Host launch needs; the caller owns the product flags. */
export interface HostDaemonLaunchSpec {
  command: string
  args: string[]
  cwd?: string
  /** Extra environment; the launcher merges it over the current process. */
  env?: Record<string, string | undefined>
}

/** Injected process starter; the default spawns a detached, unref'd child. */
export type HostDaemonLauncher = (spec: HostDaemonLaunchSpec, logPath: string) => void | Promise<void>

export type HostDaemonErrorCode =
  /** No daemon answers and this caller is not allowed to start one. */
  | 'not-running'
  /** A live Host speaks another discovery protocol; only the user can stop it. */
  | 'incompatible'
  /** A Host was started but never published a healthy endpoint. */
  | 'start-timeout'
  /** A live Host runs another product version; only the user can stop it. */
  | 'version-mismatch'
  /** The launch itself failed (missing executable, rejected spawn, ...). */
  | 'start-failed'

/** Discovery or startup failure with a stable code for localized UI copy. */
export class HostDaemonError extends Error {
  constructor(
    readonly code: HostDaemonErrorCode,
    message: string,
    readonly record?: HostEndpointRecord,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'HostDaemonError'
  }
}

export interface EnsureHostDaemonOptions {
  /** Daemon files for the state root this client belongs to. */
  paths: HostDaemonRoots
  /**
   * `false` or absent attaches only. A launch spec starts a detached Host when
   * no daemon answers, which is how any client wakes the Host without relying
   * on an operating-system login autostart.
   */
  spawn?: false | HostDaemonLaunchSpec
  /** Total budget for a cold start, including process spawn and Host boot. */
  timeoutMs?: number
  /** Budget for one health probe against a published endpoint. */
  probeTimeoutMs?: number
  /** Delay between discovery attempts while a Host boots. */
  intervalMs?: number
  /**
   * Product version this client runs. A live Host that reports another version
   * would serve its own (older) plugin set to this client's first session, so
   * attaching is refused with `version-mismatch` instead of failing silently;
   * stopping a Host that other clients may use stays a user action.
   */
  version?: string
  /**
   * Whether a launch spec may stop a live Host that answers with another
   * version. Defaults to true for the installer and an explicit `host start`;
   * a plain client passes false so two installed releases sharing one state
   * root cannot pull the daemon back and forth.
   */
  replaceStale?: boolean
  fetch?: typeof fetch
  /** Replace the detached launcher; tests capture the spec instead of spawning. */
  launch?: HostDaemonLauncher
  /** Progress notes for a launcher UI; a cold start can take seconds. */
  onProgress?: (message: string) => void
}

/** One attached Host, plus whether this call is what started it. */
export interface HostDaemonConnection {
  record: HostEndpointRecord
  health: Health
  /** True when this call spawned the Host instead of attaching to a live one. */
  started: boolean
}

/**
 * Attach to the Host daemon for a state root, starting one if necessary.
 *
 * The daemon outlives its clients: closing a client detaches instead of stopping
 * the daemon. A live Host serving another product version is replaced only when
 * the caller allows it (`replaceStale`, which the installer and an explicit
 * `hulala host start` pass): the user launched a client of the installed
 * version, so serving the plugin set the old daemon booted with would be wrong.
 * A plain client refuses instead, because two installed releases sharing a
 * state root would otherwise pull the daemon back and forth, dropping every
 * window each time. The replacement is sequential: the old daemon is stopped
 * before the new one starts, so a state root never holds two Hosts.
 *
 * @param options - daemon files plus the optional launch spec.
 * @returns the live endpoint record and its health document.
 * @throws HostDaemonError when attaching or starting cannot succeed.
 */
export async function ensureHostDaemon(options: EnsureHostDaemonOptions): Promise<HostDaemonConnection> {
  const files = resolveHostDaemonPaths(options.paths)
  const probe = { fetch: options.fetch, timeoutMs: options.probeTimeoutMs }
  const discovery = await discoverHostDaemon(files, probe)
  const stale = discovery.status === 'ready' && options.version !== undefined && discovery.record.version !== options.version
  if (discovery.status === 'ready' && !stale) return { record: discovery.record, health: discovery.health, started: false }
  if (stale && (options.spawn === undefined || options.spawn === false || options.replaceStale === false)) throw versionMismatch(discovery.record, options.version!)
  if (discovery.status === 'incompatible') throw incompatible(discovery.record)
  const spec = options.spawn
  if (spec === undefined || spec === false) throw notRunning(files, discovery)
  if (stale) {
    // Stopping is this call's own replacement, not a client closing: the daemon
    // serves another version's code, and the caller is a launcher.
    options.onProgress?.(`Replacing the Hulala Host ${discovery.record.version} with ${options.version}`)
    await stopHostDaemon(options.paths, {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.probeTimeoutMs === undefined ? {} : { timeoutMs: options.probeTimeoutMs }),
    })
  }

  const launch = options.launch ?? spawnDetached
  options.onProgress?.('Starting the Hulala Host')
  try {
    await launch(spec, files.log)
  } catch (error) {
    throw new HostDaemonError('start-failed', 'Failed to start the Hulala Host', undefined, { cause: error })
  }
  return { ...await waitForDaemon(options, files), started: true }
}

/**
 * Stop the Host that owns a state root, if any.
 * @param paths - daemon files for the state root.
 * @param options - injectable clock and probe behaviour.
 * @returns `absent` when nothing was running, otherwise `stopped`.
 */
export async function stopHostDaemon(
  paths: HostDaemonRoots,
  options: Omit<EnsureHostDaemonOptions, 'spawn' | 'paths' | 'launch' | 'onProgress'> = {},
): Promise<'absent' | 'stopped'> {
  const files = resolveHostDaemonPaths(paths)
  const record = await readHostEndpoint(files)
  if (record === undefined) return 'absent'
  // Only signal a process that proves it owns this endpoint; a recycled pid from
  // a stale file must never be terminated.
  const health = await probeHostEndpoint(record, { fetch: options.fetch, timeoutMs: options.probeTimeoutMs })
  if (health === undefined) {
    await rm(files.endpoint, { force: true })
    return 'stopped'
  }
  await terminate(record.pid)
  const deadline = Date.now() + (options.timeoutMs ?? 10_000)
  while (Date.now() < deadline) {
    if (!isAlive(record.pid)) {
      await rm(files.endpoint, { force: true })
      return 'stopped'
    }
    await sleep(options.intervalMs ?? 50)
  }
  // A Host that ignores SIGTERM must not block the next start.
  await terminate(record.pid, 'SIGKILL')
  await rm(files.endpoint, { force: true })
  return 'stopped'
}

async function waitForDaemon(
  options: EnsureHostDaemonOptions,
  files: HostDaemonPaths,
): Promise<{ record: HostEndpointRecord; health: Health }> {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000)
  const probe = { fetch: options.fetch, timeoutMs: options.probeTimeoutMs }
  let last: HostDaemonDiscovery = { status: 'missing' }
  while (Date.now() < deadline) {
    const discovery = await discoverHostDaemon(files, probe)
    if (discovery.status === 'ready') return { record: discovery.record, health: discovery.health }
    if (discovery.status === 'incompatible') throw incompatible(discovery.record)
    last = discovery
    await sleep(options.intervalMs ?? 100)
  }
  const detail = last.status === 'unhealthy' ? 'the Host published an endpoint but never answered' : 'the Host did not publish an endpoint'
  throw new HostDaemonError('start-timeout', `Timed out waiting for the Hulala Host: ${detail}. See ${files.log}`, last.status === 'missing' ? undefined : last.record)
}

function incompatible(record: HostEndpointRecord): HostDaemonError {
  return new HostDaemonError(
    'incompatible',
    `The running Hulala Host speaks protocol ${record.protocol}, but this client requires ${HOST_DAEMON_PROTOCOL}. Stop the running Host and start it again.`,
    record,
  )
}

function versionMismatch(record: HostEndpointRecord, version: string): HostDaemonError {
  return new HostDaemonError(
    'version-mismatch',
    `Hulala ${record.version} is still running as this machine's Host, but this caller is ${version} and may not replace it. Run \`hulala host stop\` and start Hulala again to load ${version}.`,
    record,
  )
}

function notRunning(files: HostDaemonPaths, discovery: HostDaemonDiscovery): HostDaemonError {
  return discovery.status === 'unhealthy'
    ? new HostDaemonError('not-running', `A Hulala Host endpoint is published at ${files.endpoint} but it does not answer. See ${files.log}`, discovery.record)
    : new HostDaemonError('not-running', 'No Hulala Host is running for this state root')
}

/** Start a Host that keeps running after this process exits. */
async function spawnDetached(spec: HostDaemonLaunchSpec, logPath: string): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true, mode: 0o700 })
  const log = await open(logPath, 'a', 0o600)
  try {
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const [key, value] of Object.entries(spec.env ?? {})) {
      if (value === undefined) delete env[key]
      else env[key] = value
    }
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env,
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    })
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('spawn', resolve)
    })
    // Detach so a quitting client never signals or waits on the Host.
    child.unref()
  } finally {
    // The child inherited the descriptor; this process no longer needs it.
    await log.close()
  }
}

async function terminate(pid: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  try {
    process.kill(pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
