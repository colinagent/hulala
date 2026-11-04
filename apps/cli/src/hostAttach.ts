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
  discoverHostDaemon,
  ensureHostDaemon,
  resolveHostDaemonPaths,
  stopHostDaemon,
  type Health,
  type HostEndpointRecord,
} from '@hulala/host-client/node'
import { VERSION } from './constants.js'
import { resolvePaths } from './paths.js'
import { appendPathEntry, ripgrepPathEntry } from './ripgrep.js'

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
 * @returns the endpoint plus the API cookie the Host issued.
 */
export async function attachHost(): Promise<HostAttachment> {
  const paths = resolvePaths()
  // The editor pickers already run the shipped `rg`; give the Host the same
  // binary so the model's `bash` calls do not depend on the machine either.
  const ripgrepPath = appendPathEntry(process.env.PATH, ripgrepPathEntry(paths.data, { packageRoot: packageRoot() }))
  const { record } = await ensureHostDaemon({
    paths: daemonRoots(paths),
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
