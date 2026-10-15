import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { APP_HOST, HEALTH_URL, WORKBENCH_PORT } from './constants.js'
import { localFetch, probeHealth } from './health.js'
import { launcherStateIdentity } from './paths.js'

export async function installationIdentity(root?: string): Promise<string> {
  const input = root || process.env.HULALA_INSTALL_ROOT || process.env.HULALA_NPM_PACKAGE_ROOT || process.env.HULALA_PACKAGE_ROOT || process.env.HULALA_REPOSITORY_ROOT || process.execPath
  return createHash('sha256').update(await realpath(input)).digest('hex')
}
export async function shutdownInstallation(root: string, force = false): Promise<boolean> {
  const health = await probeHealth()
  if (!health) return false
  if (health.installationId !== await installationIdentity(root)) return false
  if (health.stateId !== await launcherStateIdentity() || health.protocol !== 1) throw new Error('The running service belongs to another state directory or uses an incompatible control protocol')
  const endpoint = new URL('/api/hulala/service', HEALTH_URL)
  const service = await (await localFetch(endpoint)).json() as { actionToken?: string }
  if (!service.actionToken) throw new Error('The running service cannot be controlled by this version')
  const response = await localFetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hulala-token': service.actionToken, origin: endpoint.origin }, body: JSON.stringify({ action: 'shutdown', force }) })
  const value = await response.json() as { error?: string }
  if (!response.ok) throw new Error(value.error || 'Could not stop the running service')
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const current = await probeHealth()
    if (!current || current.pid !== health.pid) {
      try { process.kill(health.pid, 0) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('The running service has not finished stopping; its active installation was left unchanged')
}
export async function prepareWorkbenchStop(force = false): Promise<void> {
  const origin = `http://${APP_HOST}:${WORKBENCH_PORT}`
  const entry = await localFetch(origin + '/', { redirect: 'manual', signal: AbortSignal.timeout(3000) })
  const cookie = entry.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('The workbench lifecycle could not be checked. Reconnect before retrying.')
  const response = await localFetch(origin + '/api/browser/lifecycle', { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'prepare', force }), signal: AbortSignal.timeout(30000) })
  const value = await response.json() as { message?: string; error?: string }
  if (!response.ok) throw new Error(value.message || value.error || 'The workbench could not prepare to stop')
}
