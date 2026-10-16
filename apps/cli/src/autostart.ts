import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { runCommand, type CommandRunner } from './process.js'
import { resolvePaths, type HulalaPaths } from './paths.js'
import { installationReceipt } from './distribution/install.js'
import { installationIdentity } from './lifecycle.js'

export type { CommandResult, CommandRunner } from './process.js'
export interface LaunchCommand { executable: string; args: string[] }
interface Job { format: 1; product: 'hulala-autostart'; owner: string; command: LaunchCommand; environment: Record<string, string> }
export interface AutostartStatus { supported: boolean; installed: boolean; active: boolean; manager: 'launchd' | 'task-scheduler' | 'systemd' | 'unsupported' }
const exists = async (path?: string) => path ? access(path).then(() => true, () => false) : false
const xml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
const argsFor = (command: LaunchCommand, config: string) => [command.executable, ...command.args, '__autostart', config]
const quoted = (value: string) => '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'
async function atomic(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = path + '.' + randomUUID() + '.tmp'
  try { await writeFile(temporary, value, { mode: 0o600 }); await rename(temporary, path) } finally { await rm(temporary, { force: true }) }
}
async function job(paths: HulalaPaths): Promise<Job | undefined> {
  try {
    const value = JSON.parse(await readFile(paths.autostartConfig, 'utf8')) as Job
    if (value.format !== 1 || value.product !== 'hulala-autostart' || !value.command || !isAbsolute(value.command.executable) || !Array.isArray(value.command.args) || !value.command.args.every(arg => typeof arg === 'string')) throw new Error('Invalid Hulala login job')
    return value
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
}
async function launchCommand(): Promise<LaunchCommand | undefined> {
  if (process.env.HULALA_INSTALL_ROOT) return { executable: (await installationReceipt(process.env.HULALA_INSTALL_ROOT)).command, args: [] }
  if (['npm', 'bun', 'pnpm'].includes(process.env.HULALA_INSTALL_SOURCE || '') && process.env.HULALA_NPM_PACKAGE_ROOT && process.env.HULALA_NODE_EXECUTABLE) {
    return { executable: process.env.HULALA_NODE_EXECUTABLE, args: [join(process.env.HULALA_NPM_PACKAGE_ROOT, 'dist/cli.js')] }
  }
}
export function macosLaunchAgent(command: LaunchCommand, config: string, log: string, label: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array>${argsFor(command, config).map(value => '<string>' + xml(value) + '</string>').join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>3</integer><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string></dict></plist>\n`
}
export function systemdUnit(command: LaunchCommand, config: string): string {
  const quote = (value: string) => JSON.stringify(value.replaceAll('%', '%%'))
  return `[Unit]\nDescription=Hulala browser workbench\nStartLimitIntervalSec=60\nStartLimitBurst=3\n\n[Service]\nType=simple\nExecStart=${argsFor(command, config).map(quote).join(' ')}\nRestart=on-failure\nRestartSec=3\nKillMode=control-group\n\n[Install]\nWantedBy=default.target\n`
}
export function windowsInstallScript(): string {
  return "$ErrorActionPreference='Stop';$action=New-ScheduledTaskAction -Execute $args[0] -Argument $args[1];$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name;$trigger=New-ScheduledTaskTrigger -AtLogOn -User $user;$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited;$settings=New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;Register-ScheduledTask -TaskName $args[2] -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Hulala browser workbench' -Force | Out-Null;Start-ScheduledTask -TaskName $args[2]"
}
async function registerJob(paths: HulalaPaths, value: Job, runner: CommandRunner, platform: NodeJS.Platform): Promise<void> {
  const command = value.command
  let result
  if (platform === 'darwin') {
    if (!paths.autostartFile || process.getuid === undefined) throw new Error('The current user login session is unavailable')
    await atomic(paths.autostartFile, macosLaunchAgent(command, paths.autostartConfig, paths.launcherLog, paths.autostartName))
    const domain = `gui/${process.getuid()}`
    await runner('launchctl', ['bootout', `${domain}/${paths.autostartName}`])
    result = await runner('launchctl', ['bootstrap', domain, paths.autostartFile])
  } else if (platform === 'linux') {
    await atomic(paths.autostartFile!, systemdUnit(command, paths.autostartConfig))
    await runner('systemctl', ['--user', 'daemon-reload'])
    result = await runner('systemctl', ['--user', 'enable', '--now', paths.autostartName + '.service'])
  } else result = await runner('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsInstallScript(), command.executable, [...command.args, '__autostart', paths.autostartConfig].map(quoted).join(' '), paths.autostartName])
  if (result.code !== 0) throw new Error('Could not register the current-user login job: ' + result.stderr.trim())
}
export async function installAutostart(paths = resolvePaths(), runner: CommandRunner = runCommand, platform: NodeJS.Platform = process.platform, injectedCommand?: LaunchCommand): Promise<AutostartStatus> {
  if (!['darwin', 'linux', 'win32'].includes(platform)) throw new Error('Login startup is not supported on this platform')
  const command = injectedCommand || await launchCommand()
  if (!command) throw new Error('Install Hulala with npm/Bun/pnpm or hulala install before enabling login startup; temporary npx and source runs are not registered')
  if (!await job(paths) && await exists(paths.autostartFile)) throw new Error('The login job path is already owned by another configuration')
  const environment: Record<string, string> = { HULALA_HOME: paths.data }
  for (const key of ['HULALA_WORKSPACE_ROOT', 'HULALA_PORT', 'HULALA_WORKBENCH_PORT', 'HULALA_REMOTE_PACKAGES', 'PATH']) if (process.env[key]) environment[key] = process.env[key]!
  const previous = await job(paths)
  const previousConfig = await readFile(paths.autostartConfig, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
  const previousFile = paths.autostartFile ? await readFile(paths.autostartFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error }) : undefined
  const value: Job = { format: 1, product: 'hulala-autostart', owner: await installationIdentity(), command, environment }
  await mkdir(paths.logs, { recursive: true, mode: 0o700 })
  await atomic(paths.autostartConfig, JSON.stringify(value, null, 2) + '\n')
  try { await registerJob(paths, value, runner, platform) }
  catch (error) {
    if (previousConfig) await atomic(paths.autostartConfig, previousConfig); else await rm(paths.autostartConfig, { force: true })
    if (paths.autostartFile) { if (previousFile) await atomic(paths.autostartFile, previousFile); else await rm(paths.autostartFile, { force: true }) }
    if (previous) await registerJob(paths, previous, runner, platform).catch(() => undefined)
    else if (platform === 'win32') await runner('schtasks.exe', ['/Delete', '/TN', paths.autostartName, '/F']).catch(() => undefined)
    throw error
  }
  return getAutostartStatus(paths, runner, platform)
}
export async function autostartBelongsTo(root: string, paths = resolvePaths()): Promise<boolean> { return (await job(paths))?.owner === await installationIdentity(root) }
export async function uninstallAutostart(paths = resolvePaths(), runner: CommandRunner = runCommand, platform: NodeJS.Platform = process.platform): Promise<AutostartStatus> {
  if (!await job(paths)) return getAutostartStatus(paths, runner, platform)
  if (platform === 'darwin' && process.getuid !== undefined) await runner('launchctl', ['bootout', `gui/${process.getuid()}/${paths.autostartName}`])
  else if (platform === 'linux') await runner('systemctl', ['--user', 'disable', '--now', paths.autostartName + '.service'])
  else if (platform === 'win32') await runner('schtasks.exe', ['/Delete', '/TN', paths.autostartName, '/F'])
  if (paths.autostartFile) await rm(paths.autostartFile, { force: true })
  await rm(paths.autostartConfig, { force: true })
  if (platform === 'linux') await runner('systemctl', ['--user', 'daemon-reload'])
  return getAutostartStatus(paths, runner, platform)
}
export async function restartAutostart(paths = resolvePaths(), runner: CommandRunner = runCommand, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (!await job(paths)) throw new Error('Login startup is not configured')
  const result = platform === 'darwin' && process.getuid !== undefined ? await runner('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${paths.autostartName}`])
    : platform === 'linux' ? await runner('systemctl', ['--user', 'restart', paths.autostartName + '.service'])
    : await runner('schtasks.exe', ['/Run', '/TN', paths.autostartName])
  if (result.code !== 0) throw new Error('Could not restart the login job: ' + result.stderr.trim())
}
export async function getAutostartStatus(paths = resolvePaths(), runner: CommandRunner = runCommand, platform: NodeJS.Platform = process.platform): Promise<AutostartStatus> {
  const value = await job(paths)
  const supported = ['darwin', 'linux', 'win32'].includes(platform) && Boolean(value || await launchCommand())
  const manager = platform === 'darwin' ? 'launchd' : platform === 'win32' ? 'task-scheduler' : platform === 'linux' ? 'systemd' : 'unsupported'
  if (!value || !supported) return { supported, installed: false, active: false, manager }
  const result = platform === 'darwin' && process.getuid !== undefined ? await runner('launchctl', ['print', `gui/${process.getuid()}/${paths.autostartName}`])
    : platform === 'linux' ? await runner('systemctl', ['--user', 'is-active', paths.autostartName + '.service'])
    : await runner('schtasks.exe', ['/Query', '/TN', paths.autostartName])
  return { supported, installed: platform === 'win32' ? result.code === 0 : await exists(paths.autostartFile), active: result.code === 0, manager }
}
