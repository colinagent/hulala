import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { commandSnapshotSchema, type Workspace, type CommandSnapshot, type CommandSummary } from '@hulala/workbench-contracts'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { EventHub } from './events'
import { HttpError } from './http'
import { resolveWorkspacePath } from './files'
import { writePrivateJson } from './config'

export type CommandRecord = CommandSnapshot
const OUTPUT_BYTES = 256 * 1024
const MAX_HISTORY = 20

export function shellCommand(command: string, platform = process.platform, shell = process.env.SHELL): string[] {
  if (!command.trim()) throw new HttpError(400, 'command_invalid', 'Enter a command')
  return platform === 'win32' ? [process.env.ComSpec || 'cmd.exe', '/d', '/s', '/c', command] : [shell || '/bin/sh', '-lc', command]
}

/** Host-owned commands survive browser views; bounded output is fetched over HTTP. */
export class CommandService {
  busyCount(): number { return new Set([...this.active.keys(), ...this.starting.keys()]).size }
  private readonly records = new Map<string, CommandRecord>()
  private readonly active = new Map<string, SubprocessHandle>()
  private readonly starting = new Map<string, { fingerprint: string; promise: Promise<{ id: string }> }>()
  private writes: Promise<unknown> = Promise.resolve()
  private timer?: ReturnType<typeof setInterval>
  private stopping = false
  constructor(private readonly events: EventHub, private readonly native?: SubprocessRuntime, private readonly directory?: string) {}

  async initialize(): Promise<void> {
    if (this.directory) try {
      const values = commandSnapshotSchema.array().max(MAX_HISTORY + 8).parse(JSON.parse(await readFile(join(this.directory, 'commands.json'), 'utf8')))
      for (const record of values.slice(-MAX_HISTORY)) {
        if (record.state === 'running' || record.state === 'stopping') Object.assign(record, { state: 'interrupted', finishedAt: new Date().toISOString(), error: 'The Host stopped before this command completed.' })
        this.records.set(record.id, record)
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    this.timer = setInterval(() => { if (this.active.size) void this.persist().catch(() => undefined) }, 2000)
    this.timer.unref()
  }
  list(workspaceId: string): CommandSummary[] { return [...this.records.values()].filter(record => record.workspaceId === workspaceId).map(({ stdout: _stdout, stderr: _stderr, ...record }) => ({ ...record, command: [...record.command] })) }
  snapshot(id: string): CommandRecord {
    const record = this.require(id)
    const handle = this.active.get(id)
    if (handle) {
      const stdout = handle.collected.stdout?.readFrom(0), stderr = handle.collected.stderr?.readFrom(0)
      record.stdout = stdout?.text || ''
      record.stderr = stderr?.text || ''
      record.truncated = Boolean(stdout?.lossy || stderr?.lossy)
    }
    return { ...record, command: [...record.command] }
  }
  async start(workspace: Workspace, command: string[] | string, cwd = '.', requestId: string = crypto.randomUUID()): Promise<{ id: string }> {
    const argv = typeof command === 'string' ? shellCommand(command) : command
    if (!argv.length || !argv[0] || argv.some(value => value.includes('\0'))) throw new HttpError(400, 'command_invalid', 'Invalid command arguments')
    const workingDirectory = await resolveWorkspacePath(workspace, cwd)
    const fingerprint = JSON.stringify([workspace.id, argv, workingDirectory])
    const pending = this.starting.get(requestId)
    if (pending) {
      if (pending.fingerprint !== fingerprint) throw new HttpError(409, 'command_identity_conflict', 'Command identity belongs to another request')
      return pending.promise
    }
    const existing = this.records.get(requestId)
    if (existing) {
      if (JSON.stringify([existing.workspaceId, existing.command, existing.cwd]) !== fingerprint) throw new HttpError(409, 'command_identity_conflict', 'Command identity belongs to another request')
      return { id: existing.id }
    }
    const promise = this.spawn(requestId, workspace.id, argv, workingDirectory)
    this.starting.set(requestId, { fingerprint, promise })
    try { return await promise } finally { this.starting.delete(requestId) }
  }
  private async spawn(id: string, workspaceId: string, command: string[], cwd: string): Promise<{ id: string }> {
    if (this.stopping) throw new HttpError(503, 'host_stopping', 'The Host is stopping')
    if (!this.native) throw new HttpError(503, 'subprocess_unavailable', 'Harness subprocess provider is unavailable')
    if (this.active.size + this.starting.size >= 8) throw new HttpError(429, 'command_limit', 'At most 8 commands can run in this Workspace')
    const record: CommandRecord = { id, workspaceId, command, cwd, startedAt: new Date().toISOString(), state: 'running', stdout: '', stderr: '', truncated: false }
    this.records.set(id, record)
    // Persist the delivery identity before spawning; uncertain restarts must not rerun it.
    try { await this.persist() } catch (error) { this.records.delete(id); throw error }
    if (this.stopping) { record.state = 'interrupted'; await this.persist(); throw new HttpError(503, 'host_stopping', 'The Host is stopping') }
    try {
      const handle = this.native.spawn({ argv: command, cwd, env: { TERM: 'dumb', NO_COLOR: '1' }, stdio: { stdin: 'pipe', stdout: { maxBytes: OUTPUT_BYTES }, stderr: { maxBytes: OUTPUT_BYTES } }, graceMs: 5000 })
      this.active.set(id, handle)
      this.changed(id)
      void handle.done.then(outcome => {
        this.snapshot(id)
        record.exitCode = outcome.exitCode
        record.state = record.state === 'stopping' ? 'stopped' : 'exited'
      }, () => {
        this.snapshot(id)
        // Native containment can reject startup when Stop wins the launch race.
        if (record.state === 'stopping') record.state = 'stopped'
        else { record.state = 'failed'; record.error = 'The command could not run. Check its executable and working directory.' }
      }).finally(async () => {
        record.finishedAt = new Date().toISOString()
        this.active.delete(id)
        this.trim()
        await this.persist().catch(() => undefined)
        this.changed(id)
      })
      return { id }
    } catch (error) { record.state = 'failed'; record.error = 'The command could not start.'; await this.persist(); throw error }
  }
  async write(id: string, data: string): Promise<void> {
    this.require(id)
    const input = this.active.get(id)?.stdin
    if (!input || input.destroyed) throw new HttpError(409, 'command_input_unavailable', 'This command is no longer accepting input')
    await new Promise<void>((resolve, reject) => input.write(data, error => error ? reject(error) : resolve()))
  }
  stop(id: string): void {
    const record = this.require(id), handle = this.active.get(id)
    if (!handle) return
    record.state = 'stopping'
    handle.terminate()
    this.changed(id)
  }
  async stopAll(): Promise<void> {
    this.stopping = true
    clearInterval(this.timer)
    await Promise.allSettled([...this.starting.values()].map(item => item.promise))
    const running = [...this.active.values()]
    for (const id of this.active.keys()) this.stop(id)
    await Promise.allSettled(running.map(async handle => { await handle.done.catch(() => undefined); await handle.waitForExit(AbortSignal.timeout(10000)) }))
    await this.persist()
  }
  private require(id: string): CommandRecord {
    const record = this.records.get(id)
    if (!record) throw new HttpError(404, 'command_not_found', 'Command not found')
    return record
  }
  private changed(id: string) { this.events.emit({ type: 'command.changed', commandId: id }) }
  private trim() {
    const completed = [...this.records.values()].filter(record => !this.active.has(record.id))
    for (const record of completed.slice(0, -MAX_HISTORY)) this.records.delete(record.id)
  }
  private async persist(): Promise<void> {
    if (!this.directory) return
    const records = [...this.records.keys()].map(id => this.snapshot(id))
    const write = this.writes.catch(() => undefined).then(() => writePrivateJson(join(this.directory!, 'commands.json'), records))
    this.writes = write
    await write
  }
}
