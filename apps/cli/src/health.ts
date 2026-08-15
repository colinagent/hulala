import { connect } from 'node:net'

import { APP_HOST, APP_NAME, APP_PORT, HEALTH_URL } from './constants.js'

export interface HealthState {
  name: typeof APP_NAME
  version: string
  pid: number
  startedAt: string
  workbench?: { state: string }
}

export async function probeHealth(url = HEALTH_URL, timeoutMs = 700): Promise<HealthState | undefined> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
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

export async function waitForHealth(timeoutMs = 45_000): Promise<HealthState | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await probeHealth()
    if (health !== undefined && (health.workbench === undefined || health.workbench.state === 'running')) return health
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return undefined
}
