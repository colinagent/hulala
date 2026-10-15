import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWorkspace } from '@hulala/workbench-contracts/browser'
import { connectionDescriptorSchema, type ConnectionDescriptor, type Workspace } from '@hulala/workbench-contracts'

export interface WorkspaceTransport {
  descriptor: ConnectionDescriptor
  workspace: Workspace
  request(path: string, init?: RequestInit): Promise<Response>
  stop(): Promise<void>
}
export interface WorkspaceWorker extends WorkspaceTransport { process: ChildProcess }
export interface WorkerOptions {
  repositoryRoot: string
  hulalaRoot: string
  workspaceRoot: string
  version: string
  executable?: string
  entrypoint?: string
  runtimeHostModule?: string
}

export class WorkspaceWorkers {
  private readonly active = new Map<string, Promise<WorkspaceWorker>>()
  private stopped = false
  constructor(readonly options: WorkerOptions) {}
  async running(): Promise<WorkspaceWorker[]> {
    return (await Promise.all([...this.active.values()].map(worker => worker.catch(() => null)))).filter((worker): worker is WorkspaceWorker => worker !== null)
  }
  get(workspace: BrowserWorkspace): Promise<WorkspaceWorker> {
    if (this.stopped) return Promise.reject(new Error('Workbench is stopping'))
    const cached = this.active.get(workspace.id)
    if (cached) return cached
    const started = this.start(workspace)
    this.active.set(workspace.id, started)
    void started.then(worker => worker.process.once('exit', () => {
      if (this.active.get(workspace.id) === started) this.active.delete(workspace.id)
    }), () => { if (this.active.get(workspace.id) === started) this.active.delete(workspace.id) })
    return started
  }
  private async start(workspace: BrowserWorkspace): Promise<WorkspaceWorker> {
    const options = this.options
    await mkdir(join(options.hulalaRoot, 'config/harness'), { recursive: true, mode: 0o700 })
    const child = spawn(options.executable ?? process.execPath, [
      options.entrypoint ?? join(options.repositoryRoot, 'apps/local-host/src/main.ts'),
      '--port', '0', '--hulala-home', options.hulalaRoot, '--workspace-root', options.workspaceRoot,
      '--runtime-host-module', options.runtimeHostModule ?? join(options.repositoryRoot, 'packages/runtime/lib/in-process.js'),
      '--runtime-repository-root', options.repositoryRoot,
    ], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, HULALA_BROWSER_WORKSPACE_ID: workspace.id, HULALA_BROWSER_WORKSPACE_PATH: workspace.path, HULALA_VERSION: options.version, DSH_TELEMETRY_DISABLED: '1' },
    })
    let exited = false
    const exit = new Promise<void>(resolve => {
      const finished = () => { exited = true; resolve() }
      child.once('exit', finished)
      child.once('error', finished)
    })
    const stop = async () => {
      if (exited) return
      if (child.connected) child.send({ type: 'hulala.stop' }, error => { if (error) child.kill('SIGTERM') })
      else child.kill('SIGTERM')
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
      timeout.unref()
      await exit
      clearTimeout(timeout)
    }
    try {
      const descriptor = await new Promise<ConnectionDescriptor>((resolve, reject) => {
        let buffer = ''
        const timeout = setTimeout(() => reject(new Error('Workspace runtime startup timed out')), 30000)
        const fail = () => { clearTimeout(timeout); reject(new Error('Workspace runtime exited before becoming ready')) }
        child.once('error', fail)
        child.once('exit', fail)
        child.stderr?.on('data', () => { /* Do not forward provider output or credentials to browsers. */ })
        child.stdout?.on('data', (data: Buffer) => {
          buffer += data.toString()
          if (buffer.length > 1_048_576) { clearTimeout(timeout); reject(new Error('Unexpected runtime startup output')); return }
          for (;;) {
            const end = buffer.indexOf('\n')
            if (end < 0) break
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
            try {
              const value = JSON.parse(line)
              if (value.type !== 'hulala-server-ready') continue
              const parsed = connectionDescriptorSchema.parse(value)
              const http = new URL(parsed.httpUrl)
              const events = new URL(parsed.eventsUrl)
              if (http.hostname !== '127.0.0.1' || http.protocol !== 'http:' || events.hostname !== '127.0.0.1' || events.protocol !== 'ws:' || events.port !== http.port) throw new Error('Runtime transport must use loopback')
              clearTimeout(timeout); child.off('exit', fail); child.off('error', fail); resolve(parsed)
            } catch { /* Non-protocol startup lines are not returned to clients. */ }
          }
        })
      })
      const request = (path: string, init: RequestInit = {}) => {
        const headers = new Headers(init.headers)
        headers.set('x-hulala-token', descriptor.token)
        headers.delete('cookie')
        headers.delete('origin')
        return fetch(new URL('/api/desktop/v1' + path, descriptor.httpUrl), { ...init, headers, proxy: false } as RequestInit)
      }
      const response = await request('/workspaces')
      const data = await response.json() as { items?: Workspace[] }
      const selected = data.items?.find(item => item.path === workspace.path)
      if (!response.ok || !selected) throw new Error('Workspace runtime returned an unexpected directory')
      return { descriptor, process: child, workspace: selected, request, stop }
    } catch (error) { await stop(); throw error }
  }
  async stop(): Promise<void> {
    this.stopped = true
    await Promise.all([...this.active.values()].map(async worker => { await (await worker.catch(() => null))?.stop() }))
    this.active.clear()
  }
}
