/**
 * Local Host discovery contract.
 *
 * A Host owns one state root and publishes `endpoint.json` beside a
 * single-instance lock, so Desktop, the terminal client and any other client
 * can attach to the same process instead of each spawning a private copy.
 *
 * Node-only: browsers must never read this file.
 *
 * @module @hulala/host-client/node
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  HOST_DAEMON_PROTOCOL,
  connectionDescriptorSchema,
  healthSchema,
  type Health,
} from './protocol.js'

/** Roots a Host owns; clients pass their resolved state directories. */
export interface HostDaemonRoots {
  /** Hulala state root child that holds the Host database and endpoint. */
  server: string
  /** Hulala state root child that holds Host logs. */
  logs: string
}

/** Files that identify one Host daemon for one state root. */
export interface HostDaemonPaths {
  /** Directory holding the endpoint and lock; created with user-only permissions. */
  directory: string
  /** Published descriptor plus process facts. */
  endpoint: string
  /** Single-instance lock owned by the running daemon. */
  lock: string
  /** Detached daemon output when a launcher redirects it. */
  log: string
}

/**
 * Resolve the daemon files for one state root.
 * @param roots - resolved Hulala state directories.
 * @returns the daemon directory and its files.
 */
export function resolveHostDaemonPaths(roots: HostDaemonRoots): HostDaemonPaths {
  const directory = join(roots.server, 'host')
  return {
    directory,
    endpoint: join(directory, 'endpoint.json'),
    lock: join(directory, 'host.lock'),
    log: join(roots.logs, 'host.log'),
  }
}

/** One running Host daemon as published on disk. */
export const hostEndpointRecordSchema = z.object({
  /** Discovery protocol the daemon was built against. */
  protocol: z.number().int().positive(),
  /** Product version reported by `/health`. */
  version: z.string().min(1),
  /** Process that owns the lock and the endpoint file. */
  pid: z.number().int().positive(),
  /** ISO timestamp of the Host boot. */
  startedAt: z.string().datetime(),
  /** Authenticated loopback transport published by the Host. */
  descriptor: connectionDescriptorSchema,
  /** Roots this daemon owns; clients must not mix roots across a daemon. */
  roots: z.object({
    hulala: z.string().min(1),
    workspace: z.string().min(1),
  }),
})

export type HostEndpointRecord = z.infer<typeof hostEndpointRecordSchema>

/**
 * Read the published endpoint without trusting it.
 * @param paths - daemon files for the state root.
 * @returns the parsed record, or undefined when absent or malformed.
 */
export async function readHostEndpoint(paths: Pick<HostDaemonPaths, 'endpoint'>): Promise<HostEndpointRecord | undefined> {
  try {
    const parsed = hostEndpointRecordSchema.safeParse(JSON.parse(await readFile(paths.endpoint, 'utf8')))
    return parsed.success ? parsed.data : undefined
  } catch {
    // A missing, half-written or foreign file is not a daemon.
    return undefined
  }
}

/** One discovery outcome; callers decide whether to attach, start or upgrade. */
export type HostDaemonDiscovery =
  | { status: 'missing' }
  | { status: 'incompatible'; record: HostEndpointRecord }
  | { status: 'unhealthy'; record: HostEndpointRecord }
  | { status: 'ready'; record: HostEndpointRecord; health: Health }

/** Optional transport facts for probing; tests inject a fetch and timeout. */
export interface HostProbeOptions {
  fetch?: typeof fetch | undefined
  timeoutMs?: number | undefined
}

/**
 * Confirm that a published endpoint still answers as the daemon it claims to be.
 * @param record - endpoint record read from disk.
 * @param options - injectable fetch and probe timeout.
 * @returns the validated health document, or undefined when it does not answer.
 */
export async function probeHostEndpoint(
  record: HostEndpointRecord,
  options: HostProbeOptions = {},
): Promise<Health | undefined> {
  const doFetch = options.fetch ?? fetch
  try {
    const response = await doFetch(new URL('/health', record.descriptor.httpUrl), {
      signal: AbortSignal.timeout(options.timeoutMs ?? 2_000),
    })
    if (!response.ok) return undefined
    const parsed = healthSchema.safeParse(await response.json())
    if (!parsed.success) return undefined
    // Reused ports and stale files must not authenticate a different process.
    if (parsed.data.instanceId !== record.descriptor.instanceId) return undefined
    if (parsed.data.pid !== record.pid) return undefined
    return parsed.data
  } catch {
    return undefined
  }
}

/**
 * Discover the Host daemon that serves one state root.
 * @param paths - daemon files for the state root.
 * @param options - injectable fetch and probe timeout.
 * @returns the discovery outcome; `ready` carries the live health document.
 */
export async function discoverHostDaemon(
  paths: Pick<HostDaemonPaths, 'endpoint'>,
  options: HostProbeOptions = {},
): Promise<HostDaemonDiscovery> {
  const record = await readHostEndpoint(paths)
  if (record === undefined) return { status: 'missing' }
  if (record.protocol !== HOST_DAEMON_PROTOCOL) return { status: 'incompatible', record }
  const health = await probeHostEndpoint(record, options)
  if (health === undefined) return { status: 'unhealthy', record }
  // The endpoint file is local, so the live process has the last word on protocol.
  if (health.protocol !== HOST_DAEMON_PROTOCOL) return { status: 'incompatible', record }
  return { status: 'ready', record, health }
}
