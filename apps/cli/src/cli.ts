import { fileURLToPath } from 'node:url'

import { getAutostartStatus, installAutostart, restartAutostart, uninstallAutostart } from './autostart.js'
import { APP_PORT, APP_URL, HEALTH_URL, VERSION } from './constants.js'
import { openBrowser } from './browser.js'
import { startDetached } from './daemon.js'
import { portIsOccupied, probeHealth, waitForHealth } from './health.js'
import { runLauncher } from './launcher.js'
import { resolvePaths } from './paths.js'
import { runWatchdog } from './watchdog.js'
import { applyManagedUpdate, checkForUpdate } from './update.js'

interface LaunchOptions {
  open: boolean
  foreground: boolean
}

function usage(): string {
  return [
    'Usage: hulala [--no-open] [--foreground]',
    '       hulala service status|start|stop|restart|install|uninstall|update',
    '',
    'Starts the local Hulala workbench and opens:',
    `  ${APP_URL}`,
  ].join('\n')
}

async function serviceRequest(action: 'start' | 'stop' | 'restart' | 'update'): Promise<any> {
  const statusResponse = await fetch(`${new URL(HEALTH_URL).origin}/api/hulala/service`, { cache: 'no-store' })
  if (!statusResponse.ok) throw new Error('Hulala launcher is not running')
  const state = await statusResponse.json() as { actionToken?: unknown }
  if (typeof state.actionToken !== 'string') throw new Error('Hulala launcher does not support service control')
  const response = await fetch(`${new URL(HEALTH_URL).origin}/api/hulala/service`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': new URL(APP_URL).origin,
      'x-hulala-token': state.actionToken,
    },
    body: JSON.stringify({ action }),
  })
  const value = await response.json() as { error?: string }
  if (!response.ok) throw new Error(value.error ?? `Service request failed (${response.status})`)
  return value
}

async function runService(args: string[]): Promise<number> {
  const command = args[0]
  if (args.length !== 1 || !['status', 'start', 'stop', 'restart', 'install', 'uninstall', 'update'].includes(command ?? '')) {
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
  if (command === 'update') {
    if (await probeHealth() !== undefined) {
      const value = await serviceRequest('update')
      console.log(JSON.stringify(value.update, null, 2))
      return 0
    }
    const autostart = await getAutostartStatus()
    if (!autostart.installed) throw new Error('Install the managed service before updating it')
    const update = await checkForUpdate()
    if (!update.available || update.latestVersion === undefined) throw new Error(update.error ?? 'No newer Hulala version is available')
    await applyManagedUpdate(update.latestVersion)
    await restartAutostart()
    console.log(`Hulala ${update.latestVersion} installed and restarting.`)
    return 0
  }
  if (command === 'start' && await probeHealth() === undefined) {
    const paths = resolvePaths()
    if (await portIsOccupied()) throw new Error(`Port ${APP_PORT} is already used by another program.`)
    await startDetached(fileURLToPath(import.meta.url), paths)
    if (await waitForHealth() === undefined) throw new Error(`Hulala did not become ready. Check ${paths.launcherLog}`)
    console.log(`Hulala is ready at ${APP_URL}`)
    return 0
  }
  const value = await serviceRequest(command as 'start' | 'stop' | 'restart')
  console.log(JSON.stringify(value.workbench, null, 2))
  return 0
}

function parseLaunchOptions(args: string[]): LaunchOptions {
  const unknown = args.filter(value => value !== '--no-open' && value !== '--foreground')
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}\n\n${usage()}`)
  return { open: !args.includes('--no-open'), foreground: args.includes('--foreground') }
}

async function launch(options: LaunchOptions): Promise<number> {
  const existing = await probeHealth()
  if (existing === undefined) {
    if (await portIsOccupied()) {
      throw new Error(`Port ${APP_PORT} is already used by another program. Stop it before starting Hulala.`)
    }
    if (options.foreground) return await runLauncher()
    const paths = resolvePaths()
    await startDetached(fileURLToPath(import.meta.url), paths)
    const ready = await waitForHealth()
    if (ready === undefined) {
      throw new Error(`Hulala did not become ready. Check the log at ${paths.launcherLog}`)
    }
  }

  if (options.open && process.env.HULALA_NO_OPEN !== '1') openBrowser(APP_URL)
  console.log(`Hulala is ready at ${APP_URL}`)
  return 0
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  if (args[0] === '__serve') return await runLauncher()
  if (args[0] === '__watchdog') return await runWatchdog(fileURLToPath(import.meta.url))
  if (args[0] === 'service') return await runService(args.slice(1))
  if (args.includes('--version') || args.includes('-V')) { console.log(VERSION); return 0 }
  if (args.includes('--help') || args.includes('-h')) { console.log(usage()); return 0 }
  return await launch(parseLaunchOptions(args))
}
