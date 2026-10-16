import { createServer, type Server } from 'node:net'
import { readFile, mkdir, rename, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { APP_HOST, APP_PORT, PREFERRED_PORT, PREFERRED_WORKBENCH_PORT, configurePorts, validPort } from './constants.js'
import { launcherStateIdentity, resolvePaths } from './paths.js'
import { probeHealth, type HealthState } from './health.js'

interface Endpoint { pid: number; port: number; workbenchPort: number; stateId: string; notices: string[] }
const endpointPath = () => join(resolvePaths().serviceRoot, 'endpoint.json')
export async function discoverLauncher(notify?: (message: string) => void): Promise<HealthState | undefined> {
  let record: Endpoint | undefined
  try { record = JSON.parse(await readFile(endpointPath(), 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
  const candidates = [...new Set([...(record && validPort(record.port) ? [record.port] : []), APP_PORT, PREFERRED_PORT, ...(!process.env.HULALA_PORT ? [3210] : [])])]
  let stateId: string | undefined
  for (const port of candidates) {
    const health = await probeHealth(`http://${APP_HOST}:${port}/api/hulala/health`)
    if (!health) continue
    stateId ??= await launcherStateIdentity()
    if (health.stateId !== stateId || health.protocol !== 1) continue
    const matched = record?.port === port && record.pid === health.pid && record.stateId === stateId && validPort(record.workbenchPort)
    const backend = matched ? record!.workbenchPort : PREFERRED_WORKBENCH_PORT
    if (backend === port) continue
    configurePorts(port, backend)
    if (matched && Array.isArray(record!.notices)) for (const notice of record!.notices) if (typeof notice === 'string') notify?.(notice)
    return health
  }
  return undefined
}
export async function saveEndpoint(endpoint: Endpoint): Promise<void> {
  await mkdir(resolvePaths().serviceRoot, { recursive: true, mode: 0o700 })
  const temporary = endpointPath() + '.' + randomUUID() + '.tmp'
  try { await writeFile(temporary, JSON.stringify(endpoint), { mode: 0o600 }); await rename(temporary, endpointPath()) }
  finally { await rm(temporary, { force: true }) }
}
export async function removeEndpoint(): Promise<void> {
  const value = await readFile(endpointPath(), 'utf8').then(JSON.parse).catch(() => undefined)
  if (value?.pid === process.pid) await rm(endpointPath(), { force: true })
}
export async function listenWithFallback(server: Server, preferred: number, notify: (message: string) => void, excluded: number[] = []): Promise<number> {
  const candidates = [...new Set([preferred, ...Array.from({length: 20}, (_, index) => 3210 + index), 0])].filter(port => !excluded.includes(port))
  for (const port of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => { server.off('listening', ready); reject(error) }
        const ready = () => { server.off('error', failed); resolve() }
        server.once('error', failed); server.once('listening', ready); server.listen(port, APP_HOST)
      })
      const actual = (server.address() as {port: number}).port
      if (actual !== preferred) notify(`Using available port ${actual} instead of ${preferred}.`)
      return actual
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE' && code !== 'EACCES' && code !== 'EPERM') throw error
      notify(code === 'EADDRINUSE' ? `Port ${port} is already in use; trying another port.` : `Port ${port} is not permitted for this user; trying another port without administrator privileges.`)
    }
  }
  throw new Error('No available local port could be opened')
}
export async function chooseWorkbenchPort(publicPort: number, notify: (message: string) => void): Promise<number> {
  const reservation = createServer()
  const port = await listenWithFallback(reservation, PREFERRED_WORKBENCH_PORT, notify, [publicPort])
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
  return port
}
