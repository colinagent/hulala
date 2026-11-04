/**
 * Single-instance Host daemon ownership.
 *
 * The Host process may outlive every client: Desktop, the CLI and the terminal
 * client all attach to one daemon per Hulala state root. Ownership is proven by
 * a lock file beside a published `endpoint.json`; a second `--daemon` start
 * reports the running daemon instead of booting a rival one.
 *
 * @module hulala-server/daemon
 */
import { chmod, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { readFileSync, unlinkSync } from 'node:fs'
import type { ConnectionDescriptor } from '@hulala/desktop-contracts'
import {
  HOST_DAEMON_PROTOCOL,
  hostEndpointRecordSchema,
  probeHostEndpoint,
  readHostEndpoint,
  resolveHostDaemonPaths,
  type HostDaemonPaths,
  type HostEndpointRecord,
} from '@hulala/desktop-contracts/hostdaemon'
import { resolveHulalaPaths } from '@hulala/desktop-contracts/paths'
import type { Health } from '@hulala/desktop-contracts'
import { writePrivateJson, type ServerConfig } from './config.ts'

/** Facts a lock owner publishes for diagnostics. */
interface LockRecord {
  pid: number
  version: string
  startedAt: string
}

/** Result of trying to become the daemon for one state root. */
export type HostDaemonLock =
  | { acquired: true; release(): Promise<void> }
  | { acquired: false; holder: LockRecord | undefined }

/** Whether a pid still exists; `EPERM` means it exists but is not ours. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Create the daemon directory with user-only permissions.
 * @param paths - daemon files for the state root.
 */
async function ensureDaemonDirectory(paths: HostDaemonPaths): Promise<void> {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 })
  await chmod(paths.directory, 0o700).catch(() => undefined)
}

/**
 * Read the lock owner without trusting the file.
 * @param path - lock file path.
 * @returns the recorded owner, or undefined when absent or malformed.
 */
async function readLock(path: string): Promise<LockRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<LockRecord>
    if (!Number.isSafeInteger(value.pid) || (value.pid ?? 0) <= 0) return undefined
    return {
      pid: value.pid as number,
      version: typeof value.version === 'string' ? value.version : '',
      startedAt: typeof value.startedAt === 'string' ? value.startedAt : '',
    }
  } catch {
    return undefined
  }
}

/**
 * Take the single-instance lock, reaping a lock whose owner died.
 * @param paths - daemon files for the state root.
 * @param owner - version reported by the new owner.
 * @returns the lock when acquired, otherwise the live holder if one is recorded.
 */
export async function acquireHostDaemonLock(
  paths: HostDaemonPaths,
  owner: { version: string },
): Promise<HostDaemonLock> {
  await ensureDaemonDirectory(paths)
  const record: LockRecord = { pid: process.pid, version: owner.version, startedAt: new Date().toISOString() }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle: Awaited<ReturnType<typeof open>>
    try {
      handle = await open(paths.lock, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const holder = await readLock(paths.lock)
      // An unreadable lock is treated as dead: the owner cannot disown it either.
      if (holder !== undefined && isAlive(holder.pid)) return { acquired: false, holder }
      await unlink(paths.lock).catch(() => undefined)
      continue
    }
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
    } finally {
      await handle.close()
    }
    await chmod(paths.lock, 0o600).catch(() => undefined)
    return {
      acquired: true,
      async release() {
        const current = await readLock(paths.lock)
        // Only the owner removes its own lock; a reaped stale file is not ours.
        if (current?.pid === process.pid) await unlink(paths.lock).catch(() => undefined)
      },
    }
  }
  return { acquired: false, holder: await readLock(paths.lock) }
}

/**
 * Publish the authenticated descriptor so clients can attach without spawning.
 * @param paths - daemon files for the state root.
 * @param input - descriptor plus the roots this daemon owns.
 */
export async function writeHostEndpoint(
  paths: HostDaemonPaths,
  input: { descriptor: ConnectionDescriptor; version: string; hulalaRoot: string; workspaceRoot: string },
): Promise<HostEndpointRecord> {
  const record = hostEndpointRecordSchema.parse({
    protocol: HOST_DAEMON_PROTOCOL,
    version: input.version,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    descriptor: input.descriptor,
    roots: { hulala: input.hulalaRoot, workspace: input.workspaceRoot },
  })
  await writePrivateJson(paths.endpoint, record)
  return record
}

/**
 * Remove the endpoint only when this process published it.
 * @param paths - daemon files for the state root.
 */
export async function clearHostEndpoint(paths: HostDaemonPaths): Promise<void> {
  const record = await readHostEndpoint(paths)
  if (record !== undefined && record.pid !== process.pid) return
  await unlink(paths.endpoint).catch(() => undefined)
}

/** Published daemon ownership for one boot of the Host. */
export interface HostDaemonLifecycle {
  readonly paths: HostDaemonPaths
  /** Publish the descriptor after the transport is ready. */
  publish(input: { descriptor: ConnectionDescriptor; version: string; hulalaRoot: string; workspaceRoot: string }): Promise<void>
  /** Idempotently remove the endpoint and release the lock. */
  dispose(): Promise<void>
}

/** One `--daemon` start outcome. */
export type HostDaemonPreparation =
  | { kind: 'ready'; lifecycle: HostDaemonLifecycle }
  | { kind: 'already-running'; record: HostEndpointRecord; health: Health }
  | { kind: 'conflict'; reason: string }

/**
 * Remove a lock or endpoint synchronously, only when this process still owns it.
 * @param path - lock or endpoint file. A missing or foreign file is left alone.
 */
function unlinkOwnedSync(path: string): void {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown }
    if (value.pid === process.pid) unlinkSync(path)
  } catch {
    // Absent or already removed: nothing to disown.
  }
}

/**
 * Claim the daemon role before booting the Host, so a second start never loads
 * plugins, cron or the product database next to a live daemon.
 * @param config - resolved Host configuration.
 * @returns the lifecycle to publish through, or the daemon that already owns the root.
 */
export async function prepareHostDaemon(config: ServerConfig): Promise<HostDaemonPreparation> {
  const paths = resolveHostDaemonPaths(resolveHulalaPaths(config.hulalaRoot, config.workspaceRoot))
  const lock = await acquireHostDaemonLock(paths, { version: config.version })
  if (!lock.acquired) {
    const record = await readHostEndpoint(paths)
    if (record !== undefined) {
      const health = await probeHostEndpoint(record)
      if (health !== undefined) return { kind: 'already-running', record, health }
      return { kind: 'conflict', reason: `Hulala Host daemon ${record.pid} holds the lock but did not answer on ${record.descriptor.httpUrl}` }
    }
    return {
      kind: 'conflict',
      reason: lock.holder === undefined
        ? `Hulala Host daemon lock is held by an unreadable owner: ${paths.lock}`
        : `Hulala Host daemon ${lock.holder.pid} is starting; the endpoint is not published yet`,
    }
  }
  let published = false
  let cleanup: Promise<void> | undefined
  const lifecycle: HostDaemonLifecycle = {
    paths,
    async publish(input) {
      await writeHostEndpoint(paths, input)
      published = true
      // A crash must not leave a stale endpoint or lock behind for the next
      // client, and must never disown files another daemon took over since.
      process.once('exit', () => {
        unlinkOwnedSync(paths.endpoint)
        unlinkOwnedSync(paths.lock)
      })
    },
    async dispose() {
      if (cleanup === undefined) {
        cleanup = (async () => {
          if (published) await clearHostEndpoint(paths)
          await lock.release()
        })().catch((error: unknown) => {
          // Keep the failure retryable: cleanup may succeed on the next stop.
          cleanup = undefined
          throw error
        })
      }
      await cleanup
    },
  }
  return { kind: 'ready', lifecycle }
}
