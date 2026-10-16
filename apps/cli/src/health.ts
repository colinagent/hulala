import { connect } from 'node:net'

import { APP_HOST, APP_NAME, APP_PORT, HEALTH_URL, VERSION } from './constants.js'

export interface HealthState {
  name: typeof APP_NAME
  version: string
  pid: number
  startedAt: string
  workbench?: { state: string; error?: string }
  stateId?: string
  installationId?: string
  protocol?: number
}

/** Process-control credentials must never travel through a configured proxy. */
export const localFetch = (url: string | URL, options: RequestInit = {}) => fetch(url, { ...options, proxy: false } as RequestInit)

export async function probeHealth(url = HEALTH_URL, timeoutMs = 700): Promise<HealthState | undefined> {
  try {
    const response = await localFetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return undefined
    const value = await response.json() as Partial<HealthState>
    if (value.name !== APP_NAME || typeof value.version !== 'string' || typeof value.pid !== 'number' || typeof value.startedAt !== 'string') {
      return undefined
    }
    return value as HealthState
  } catch {
    return undefined
  }
}

export async function portIsOccupied(host = APP_HOST, port = APP_PORT, timeoutMs = 500): Promise<boolean> {
  return await new Promise(resolve => {
    const socket = connect({ host, port })
    const finish = (occupied: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(occupied)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

export async function waitForHealth(timeoutMs = 45_000, progress?: (elapsedSeconds: number, health?: HealthState) => void, probe = probeHealth): Promise<HealthState | undefined> {
  const started = Date.now()
  let nextProgress = started + 3000
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await probe()
    if (health?.version === VERSION && health.workbench?.state === 'running') return health
    if (health?.workbench?.state === 'crashed') throw new Error(health.workbench.error || 'The workbench failed to start')
    if (Date.now() >= nextProgress) { progress?.(Math.floor((Date.now() - started) / 1000), health); nextProgress = Date.now() + 3000 }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return undefined
}
