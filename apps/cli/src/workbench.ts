import type { ChildProcess } from 'node:child_process'
import { rm } from 'node:fs/promises'

import { probeHealth } from './health.js'
import { spawnWorkbench } from './harness.js'
import { VERSION, WORKBENCH_HEALTH_URL } from './constants.js'

export type WorkbenchState = 'stopped' | 'starting' | 'running' | 'stopping' | 'restarting' | 'crashed'

export interface WorkbenchStatus {
  state: WorkbenchState
  pid?: number
  version: string
  startedAt?: string
  uptimeMs?: number
  lastExitCode?: number | null
  lastSignal?: NodeJS.Signals | null
  error?: string
}

type SpawnResult = Awaited<ReturnType<typeof spawnWorkbench>>

export class WorkbenchController {
  private child: ChildProcess | undefined
  private temporaryDirectory: string | undefined
  private state: WorkbenchState = 'stopped'
  private startedAt: string | undefined
  private lastExitCode?: number | null
  private lastSignal?: NodeJS.Signals | null
  private error: string | undefined
  private transition: Promise<void> = Promise.resolve()
  private desiredRunning = false
  private recentCrashes: number[] = []
  private restartTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly spawn: () => Promise<SpawnResult> = spawnWorkbench,
    private readonly healthUrl = WORKBENCH_HEALTH_URL,
  ) {}

  status(now = Date.now()): WorkbenchStatus {
    const started = this.startedAt === undefined ? undefined : Date.parse(this.startedAt)
    return {
      state: this.state,
      ...(this.child?.pid === undefined ? {} : { pid: this.child.pid }),
      version: VERSION,
      ...(this.startedAt === undefined ? {} : { startedAt: this.startedAt }),
      ...(started === undefined || Number.isNaN(started) ? {} : { uptimeMs: Math.max(0, now - started) }),
      ...(this.lastExitCode === undefined ? {} : { lastExitCode: this.lastExitCode }),
      ...(this.lastSignal === undefined ? {} : { lastSignal: this.lastSignal }),
      ...(this.error === undefined ? {} : { error: this.error }),
    }
  }

  isAvailable(): boolean {
    return this.state === 'running'
  }

  start(): Promise<void> {
    this.desiredRunning = true
    return this.enqueue(async () => {
      if (this.child !== undefined && (this.state === 'running' || this.state === 'starting')) return
      await this.startNow('starting')
    })
  }

  stop(): Promise<void> {
    this.desiredRunning = false
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    return this.enqueue(async () => { await this.stopNow() })
  }

  restart(): Promise<void> {
    this.desiredRunning = true
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    return this.enqueue(async () => {
      this.state = 'restarting'
      await this.stopNow(true)
      await this.startNow('restarting')
    })
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const task = this.transition.then(operation, operation)
    this.transition = task.catch(() => undefined)
    return task
  }

  private async startNow(initialState: WorkbenchState): Promise<void> {
    this.state = initialState
    this.error = undefined
    let spawned: SpawnResult
    try {
      spawned = await this.spawn()
    } catch (error) {
      this.state = 'crashed'
      this.error = error instanceof Error ? error.message : String(error)
      throw error
    }
    this.child = spawned.child
    this.temporaryDirectory = spawned.temporaryDirectory
    const child = spawned.child
    child.once('exit', (code, signal) => { void this.onExit(child, code, signal) })
    child.once('error', error => { this.error = error.message })

    const deadline = Date.now() + 45_000
    while (Date.now() < deadline && this.child === child) {
      const health = await probeHealth(this.healthUrl, 700)
      if (health !== undefined) {
        this.startedAt = health.startedAt
        this.state = 'running'
        return
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    if (this.child !== child) throw new Error(this.error ?? 'Workbench exited before it became ready')
    this.error = 'Workbench did not become ready within 45 seconds'
    await this.stopNow()
    this.state = 'crashed'
    throw new Error(this.error)
  }

  private async stopNow(preserveState = false): Promise<void> {
    const child = this.child
    if (child === undefined) {
      if (!preserveState) this.state = 'stopped'
      return
    }
    if (!preserveState) this.state = 'stopping'
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
    child.kill('SIGTERM')
    let timeout: NodeJS.Timeout | undefined
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<false>(resolve => { timeout = setTimeout(() => resolve(false), 15_000) }),
    ])
    if (timeout !== undefined) clearTimeout(timeout)
    if (!graceful) {
      child.kill('SIGKILL')
      await exited
    }
    if (!preserveState) this.state = 'stopped'
  }

  private async onExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (this.child !== child) return
    this.child = undefined
    this.startedAt = undefined
    this.lastExitCode = code
    this.lastSignal = signal
    if (this.temporaryDirectory !== undefined) {
      const path = this.temporaryDirectory
      this.temporaryDirectory = undefined
      await rm(path, { recursive: true, force: true })
    }
    if (!this.desiredRunning || this.state === 'stopping') {
      this.state = 'stopped'
      return
    }
    if (this.state === 'restarting') return

    const now = Date.now()
    this.recentCrashes = this.recentCrashes.filter(value => now - value < 60_000)
    this.recentCrashes.push(now)
    if (this.recentCrashes.length > 3) {
      this.state = 'crashed'
      this.error = 'Workbench stopped repeatedly; automatic restart is paused'
      return
    }
    this.state = 'restarting'
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      void this.enqueue(async () => {
        if (this.desiredRunning && this.child === undefined) await this.startNow('restarting')
      }).catch(error => { this.error = error instanceof Error ? error.message : String(error) })
    }, 1_000)
    this.restartTimer.unref()
  }
}
