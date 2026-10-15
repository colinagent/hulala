import { createServer, type Socket } from 'node:net'
import { z } from 'zod'
import { connectionDescriptorSchema, workspaceSchema } from '@hulala/workbench-contracts'
import type { BrowserWorkspace } from '@hulala/workbench-contracts/browser'
import type { WorkspaceTransport } from '../browser/workers'
import { connectSsh, type SshConnection, type SshTrust } from './connection'
import type { SshHosts } from './hosts'
import { SshPackages } from './install'
import { HttpError } from '../http'
import { remoteJoin } from './package'
import { normalizeManagedWorkspaceName } from '../workspaces'

const readySchema = z.object({ descriptor: connectionDescriptorSchema, path: z.string(), home: z.string(),
  platform: z.enum(['darwin', 'linux', 'win32']), arch: z.enum(['arm64', 'x64']), version: z.string() })
export type RemoteInfo = { hostLabel: string; workspaceDir: string; instanceId: string; runtimeVersion: string; platform: string; arch: string }
export type RemoteWorker = WorkspaceTransport & { path: string; home: string; remote: RemoteInfo; alive(): boolean; healthy(): Promise<boolean> }
type ConnectionHandle = { connection: SshConnection; installed: Awaited<ReturnType<SshPackages['ensure']>> }
function remoteResult(text: string): any {
  const value = JSON.parse(text)
  const code = value?.error?.code
  if (code === 'version_conflict') throw new HttpError(409, 'ssh_runtime_version', 'This remote Workspace is assigned to another Hulala version. Restart its Host to use this version.')
  if (code === 'active_work') throw new HttpError(409, 'ssh_active_work', 'The remote Workspace has running Agent turns, commands, Cron runs or plugins. Restarting will stop that work.')
  if (code === 'state_unavailable') throw new HttpError(409, 'ssh_runtime_unavailable', 'The remote Host cannot be verified or safely stopped. Wait for it to respond, or inspect the existing process on the remote machine.')
  if (code) throw new Error('Unexpected remote operation result')
  return value
}

export class RemoteWorkspaceWorkers {
  private readonly connections = new Map<string, Promise<ConnectionHandle>>()
  private readonly workers = new Map<string, Promise<RemoteWorker>>()
  private stopped = false
  constructor(private readonly hosts: SshHosts, private readonly trust: SshTrust, private readonly packages: SshPackages, private readonly version: string) {}
  private async connection(hostId: string): Promise<ConnectionHandle> {
    const cached = this.connections.get(hostId)
    if (cached) {
      const value = await cached
      if (value.connection.alive()) return value
      if (this.connections.get(hostId) !== cached) return this.connection(hostId)
      this.connections.delete(hostId)
    }
    const pending = (async () => {
      const connection = await connectSsh(await this.hosts.resolve(hostId), this.hosts, this.trust)
      try {
        const installed = await this.packages.ensure(connection)
        if (installed.version !== this.version) throw new HttpError(409, 'ssh_version_mismatch', 'The remote Host package must match this Hulala version')
        void connection.closed.then(() => { if (this.connections.get(hostId) === pending) this.connections.delete(hostId) })
        return { connection, installed }
      } catch (error) { await connection.stop(); throw error }
    })()
    this.connections.set(hostId, pending)
    void pending.catch(() => { if (this.connections.get(hostId) === pending) this.connections.delete(hostId) })
    return pending
  }
  get(workspace: BrowserWorkspace): Promise<RemoteWorker> {
    if (workspace.kind !== 'remote' || !workspace.hostId) return Promise.reject(new Error('Remote Workspace identity is missing'))
    return this.open(workspace.hostId, workspace.path, false)
  }
  async directory(hostId: string, path: string | undefined, metadataOnly = false) {
    const { connection, installed } = await this.connection(hostId)
    const sftp = await connection.sftp()
    try {
      const canonical = await new Promise<string>((resolve, reject) => sftp.realpath(path || installed.home, (error, value) => error ? reject(error) : resolve(value)))
      const info = await new Promise<import('ssh2').Stats>((resolve, reject) => sftp.stat(canonical, (error, value) => error ? reject(error) : resolve(value)))
      const item = { path: canonical, name: canonical.split('/').pop() || canonical, isDir: info.isDirectory(), size: info.size, modTime: info.mtime * 1000 }
      if (metadataOnly) return item
      if (!info.isDirectory()) throw new HttpError(400, 'ssh_directory_required', 'Choose a directory on the remote Host')
      const entries = await new Promise<import('ssh2').FileEntryWithStats[]>((resolve, reject) => sftp.readdir(canonical, (error, value) => error ? reject(error) : resolve(value)))
      return { path: canonical, entries: entries.filter(entry => entry.filename !== '.' && entry.filename !== '..').slice(0, 10000).map(entry => ({
        path: remoteJoin(canonical, entry.filename), name: entry.filename, isDir: entry.attrs.isDirectory(), size: entry.attrs.size, modTime: entry.attrs.mtime * 1000,
      })) }
    } finally { sftp.end() }
  }
  async createManaged(hostId: string, name: string): Promise<RemoteWorker> {
    const leaf = normalizeManagedWorkspaceName(name)
    const { connection, installed } = await this.connection(hostId)
    const sftp = await connection.sftp()
    const root = remoteJoin(installed.home, 'hulala-workspace'), path = remoteJoin(root, leaf)
    try {
      await new Promise<void>((resolve, reject) => sftp.mkdir(root, { mode: 0o700 }, error => {
        if (!error) { resolve(); return }
        sftp.stat(root, (statError, value) => statError || !value.isDirectory() ? reject(error) : resolve())
      }))
      await new Promise<void>((resolve, reject) => sftp.mkdir(path, { mode: 0o700 }, error => {
        if (!error) { resolve(); return }
        sftp.stat(path, statError => reject(statError ? error : new HttpError(409, 'workspace_exists', 'This remote Workspace already exists. Open it from the directory picker.')))
      }))
    } finally { sftp.end() }
    return this.open(hostId, path)
  }
  async restart(hostId: string, path?: string, force = false): Promise<RemoteWorker> {
    const { connection, installed } = await this.connection(hostId)
    const result = z.object({ stopped: z.literal(true), path: z.string().min(1) }).parse(remoteResult(await connection.capture(installed.stopCommand, 65536, JSON.stringify({ ...(path ? { path } : {}), force }), 90000)))
    for (const [key, pending] of [...this.workers]) {
      const worker = await pending.catch(() => null)
      if (worker && JSON.parse(key)[0] === hostId && worker.path === result.path) { await worker.stop(); this.workers.delete(key) }
    }
    return this.open(hostId, result.path)
  }
  async open(hostId: string, path?: string, probe = true): Promise<RemoteWorker> {
    if (this.stopped) throw new Error('Hulala is stopping')
    const key = JSON.stringify([hostId, path || ''])
    const cached = this.workers.get(key)
    if (cached) {
      const value = await cached
      if (value.alive() && (!probe || await value.healthy())) return value
      if (this.workers.get(key) !== cached) return this.open(hostId, path, probe)
      this.workers.delete(key)
    }
    const pending: Promise<RemoteWorker> = this.start(hostId, path).then(async worker => {
      const canonicalKey = JSON.stringify([hostId, worker.path])
      const existing = this.workers.get(canonicalKey)
      if (existing && existing !== pending) {
        const previous = await existing
        if (previous.alive() && previous.descriptor.instanceId === worker.descriptor.instanceId) { await worker.stop(); return previous }
        await previous.stop()
      }
      this.workers.set(canonicalKey, pending)
      return worker
    })
    this.workers.set(key, pending)
    void pending.catch(() => { if (this.workers.get(key) === pending) this.workers.delete(key) })
    return pending
  }
  private async start(hostId: string, path?: string): Promise<RemoteWorker> {
    const { connection, installed } = await this.connection(hostId)
    const ready = readySchema.parse(remoteResult(await connection.capture(installed.startCommand, 65536, JSON.stringify({ ...(path ? { path } : {}) }))))
    if (ready.version !== this.version || ready.platform !== installed.platform || ready.arch !== installed.arch) throw new Error('Unexpected remote Host version or architecture')
    const remoteUrl = new URL(ready.descriptor.httpUrl), events = new URL(ready.descriptor.eventsUrl)
    if (remoteUrl.protocol !== 'http:' || remoteUrl.hostname !== '127.0.0.1' || events.protocol !== 'ws:' || events.hostname !== '127.0.0.1' || events.port !== remoteUrl.port) throw new Error('Remote Host must bind to loopback')
    const sockets = new Set<Socket>()
    const server = createServer(socket => {
      sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {})
      connection.client.forwardOut('127.0.0.1', socket.remotePort || 0, '127.0.0.1', Number(remoteUrl.port), (error, channel) => {
        if (error || socket.destroyed) { channel?.close(); socket.destroy(); return }
        channel.on('error', () => socket.destroy()); socket.once('error', () => channel.close())
        socket.pipe(channel).pipe(socket)
      })
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No SSH forwarding port is available')
    const httpUrl = `http://127.0.0.1:${address.port}`
    const descriptor = { ...ready.descriptor, httpUrl, eventsUrl: httpUrl.replace('http:', 'ws:') + events.pathname }
    let closed = false
    const stop = async () => {
      if (closed) return; closed = true
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
    void connection.closed.then(stop)
    const request = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers); headers.delete('cookie'); headers.delete('origin'); headers.set('x-hulala-token', descriptor.token)
      try { return await fetch(new URL('/api/desktop/v1' + path, descriptor.httpUrl), { ...init, headers, proxy: false } as RequestInit) }
      catch (error) { if (!init.signal?.aborted) await stop(); throw error }
    }
    try {
      const response = await request('/workspaces', { signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw new Error('Remote Workspace could not be loaded')
      const { items } = z.object({ items: z.array(workspaceSchema) }).parse(await response.json())
      const workspace = items.find(item => item.path === ready.path)
      if (!workspace) throw new Error('Remote Host returned an unexpected Workspace')
      return { descriptor, workspace, path: ready.path, home: ready.home, remote: { hostLabel: this.hosts.get(hostId).alias, workspaceDir: ready.path,
        instanceId: descriptor.instanceId, runtimeVersion: ready.version, platform: ready.platform, arch: ready.arch },
        request, stop, alive: () => !closed && connection.alive(), healthy: async () => {
          try {
            const response = await request('/health', { signal: AbortSignal.timeout(5000) })
            const health = await response.json() as { instanceId?: string; version?: string }
            if (response.ok && health.instanceId === ready.descriptor.instanceId && health.version === this.version) return true
          } catch {}
          await stop(); return false
        } }
    } catch (error) { await stop(); throw error }
  }
  async stop() {
    this.stopped = true
    await Promise.allSettled([...this.workers.values()].map(async pending => (await pending).stop()))
    await Promise.allSettled([...this.connections.values()].map(async pending => (await pending).connection.stop()))
    this.workers.clear(); this.connections.clear()
  }
}
