import { fileURLToPath } from 'node:url'

import { getAutostartStatus, installAutostart, uninstallAutostart } from './autostart.js'
import { APP_PORT, APP_URL, HEALTH_URL, VERSION } from './constants.js'
declare const __HULALA_COMPILED__: boolean | undefined
import { openBrowser } from './browser.js'
import { startDetached } from './daemon.js'
import { localFetch, portIsOccupied, probeHealth, waitForHealth, type HealthState } from './health.js'
import { runLauncher } from './launcher.js'
import { launcherStateIdentity, resolvePaths } from './paths.js'
import { runDistributionCommand } from './distribution/commands.js'

interface LaunchOptions {
  open: boolean
  foreground: boolean
}

function usage(): string {
  return [
    'Usage: hulala [--no-open] [--foreground]',
    '       hulala install|update|rollback|uninstall|doctor [options]',
    '       hulala service status|start|stop|restart|shutdown|install|uninstall [--force]',
    '',
    'Starts the local Hulala workbench and opens:',
    `  ${APP_URL}`,
  ].join('\n')
}

async function serviceRequest(action: 'start' | 'stop' | 'restart' | 'shutdown', force = false): Promise<any> {
  const health = await probeHealth()
  if (!health) throw new Error('Hulala launcher is not running')
  await assertCompatibleHealth(health, true)
  const statusResponse = await localFetch(`${new URL(HEALTH_URL).origin}/api/hulala/service`, { cache: 'no-store' })
  if (!statusResponse.ok) throw new Error('Hulala launcher is not running')
  const state = await statusResponse.json() as { actionToken?: unknown }
  if (typeof state.actionToken !== 'string') throw new Error('Hulala launcher does not support service control')
  const response = await localFetch(`${new URL(HEALTH_URL).origin}/api/hulala/service`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': new URL(HEALTH_URL).origin,
      'x-hulala-token': state.actionToken,
    },
    body: JSON.stringify({ action, force }),
  })
  const value = await response.json() as { error?: string }
  if (!response.ok) throw new Error(value.error ?? `Service request failed (${response.status})`)
  return value
}

async function assertCompatibleHealth(health: HealthState, control = false): Promise<void> {
  if ((control ? health.protocol !== 1 : health.version !== VERSION) || health.stateId !== await launcherStateIdentity()) {
    throw new Error(`Port ${APP_PORT} belongs to an incompatible Hulala instance or a different state directory. Stop that instance explicitly, or choose HULALA_PORT and HULALA_WORKBENCH_PORT.`)
  }
}

async function runService(args: string[]): Promise<number> {
  const force = args.includes('--force')
  args = args.filter(value => value !== '--force')
  const command = args[0]
  if (args.length !== 1 || !['status', 'start', 'stop', 'restart', 'shutdown', 'install', 'uninstall'].includes(command ?? '')) {
    throw new Error(`Unknown service command: ${args.join(' ') || '(missing)'}\n\n${usage()}`)
  }
  if (command === 'install') {
    const status = await installAutostart()
    console.log(`Login autostart installed with ${status.manager}.`)
    return 0
  }
  if (command === 'uninstall') {
    await uninstallAutostart()
    console.log('Login autostart removed. The current local service was left running.')
    return 0
  }
  if (command === 'status') {
    const [health, autostart] = await Promise.all([probeHealth(), getAutostartStatus()])
    console.log(JSON.stringify({ launcher: health ?? { state: 'stopped' }, autostart }, null, 2))
    return health === undefined ? 1 : 0
  }
  if (command === 'start' && await probeHealth() === undefined) {
    const paths = resolvePaths()
    if (await portIsOccupied()) throw new Error(`Port ${APP_PORT} is already used by another program.`)
    await startDetached(typeof __HULALA_COMPILED__ !== 'undefined' && __HULALA_COMPILED__ ? process.execPath : fileURLToPath(import.meta.url), paths)
    if (await waitForHealth() === undefined) throw new Error(`Hulala did not become ready. Check ${paths.launcherLog}`)
    console.log(`Hulala is ready at ${APP_URL}`)
    return 0
  }
  const value = await serviceRequest(command as 'start' | 'stop' | 'restart' | 'shutdown', force)
  console.log(JSON.stringify(value.workbench ?? value, null, 2))
  return 0
}

function parseLaunchOptions(args: string[]): LaunchOptions {
  const unknown = args.filter(value => value !== '--no-open' && value !== '--foreground')
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}\n\n${usage()}`)
  return { open: !args.includes('--no-open'), foreground: args.includes('--foreground') }
}

async function launch(options: LaunchOptions): Promise<number> {
  let existing = await probeHealth()
  if (existing) await assertCompatibleHealth(existing)
  if (existing === undefined) {
    if (await portIsOccupied()) {
      // Another terminal may have won the loopback listener between our probe
      // and connect. The listener is the exclusive launch lock; only its owner
      // starts a Host. Reuse a compatible winner instead of reporting failure.
      existing = await probeHealth()
      if (!existing) throw new Error(`Port ${APP_PORT} is already used by another program. Stop it before starting Hulala.`)
      await assertCompatibleHealth(existing)
    }
    if (!existing && options.foreground) return await runLauncher({ onReady: () => {
      if (options.open && process.env.HULALA_NO_OPEN !== '1') openBrowser(APP_URL)
    } })
    if (!existing) await startDetached(typeof __HULALA_COMPILED__ !== 'undefined' && __HULALA_COMPILED__ ? process.execPath : fileURLToPath(import.meta.url), resolvePaths())
    const ready = await waitForHealth()
    if (ready === undefined) {
      throw new Error(`Hulala did not become ready. Check the log at ${resolvePaths().launcherLog}`)
    }
    await assertCompatibleHealth(ready)
    existing = ready
  }

  if (existing && existing.workbench?.state !== 'running') {
    await serviceRequest('start')
    if (await waitForHealth() === undefined) throw new Error('The browser workbench did not become ready')
  }

  if (options.open && process.env.HULALA_NO_OPEN !== '1') openBrowser(APP_URL)
  console.log(`Hulala is ready at ${APP_URL}`)
  return 0
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  if (['install', 'update', 'rollback', 'uninstall', 'doctor'].includes(args[0] || '')) return runDistributionCommand(args[0]!, args.slice(1))
  if (args[0] === '__serve') return await runLauncher()
  if (args[0] === 'service') return await runService(args.slice(1))
  if (args.includes('--version') || args.includes('-V')) { console.log(VERSION); return 0 }
  if (args.includes('--help') || args.includes('-h')) { console.log(usage()); return 0 }
  return await launch(parseLaunchOptions(args))
}
