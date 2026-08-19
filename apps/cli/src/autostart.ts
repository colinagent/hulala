import { access, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

import { VERSION } from './constants.js'
import { activateManagedVersion, runCommand, stageManagedVersion, type CommandRunner, type CommandResult } from './managed-runtime.js'
import { resolvePaths, type HulalaPaths } from './paths.js'

export const MACOS_LABEL = 'ai.hulala.launcher'
export const WINDOWS_TASK = 'Hulala'

export type { CommandResult, CommandRunner }

export interface AutostartStatus {
  supported: boolean
  installed: boolean
  active: boolean
  manager: 'launchd' | 'task-scheduler' | 'unsupported'
}

async function exists(path: string | undefined): Promise<boolean> {
  if (path === undefined) return false
  try { await access(path); return true } catch { return false }
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character] ?? character)
}

export function macosLaunchAgent(entryPath: string, logPath: string, nodePath = process.execPath): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${MACOS_LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(entryPath)}</string><string>__watchdog</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict></plist>
`
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

async function installMacOS(paths: HulalaPaths, runner: CommandRunner): Promise<void> {
  if (paths.autostartFile === undefined || process.getuid === undefined) throw new Error('macOS LaunchAgent path is unavailable')
  await mkdir(paths.logs, { recursive: true })
  await atomicWrite(paths.autostartFile, macosLaunchAgent(paths.serviceEntry, paths.launcherLog))
  const domain = `gui/${process.getuid()}`
  await runner('launchctl', ['bootout', `${domain}/${MACOS_LABEL}`])
  const result = await runner('launchctl', ['bootstrap', domain, paths.autostartFile])
  if (result.code !== 0) throw new Error(result.stderr.trim() || `launchctl bootstrap failed (${result.code})`)
}

export function windowsInstallScript(): string {
  return [
    '$ErrorActionPreference = "Stop"',
    '$action = New-ScheduledTaskAction -Execute $args[0] -Argument ("`"" + $args[1] + "`" __watchdog")',
    '$trigger = New-ScheduledTaskTrigger -AtLogOn',
    '$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
    `Register-ScheduledTask -TaskName "${WINDOWS_TASK}" -Action $action -Trigger $trigger -Settings $settings -Description "Hulala local launcher watchdog" -Force | Out-Null`,
    `Start-ScheduledTask -TaskName "${WINDOWS_TASK}"`,
  ].join('; ')
}

async function installWindows(paths: HulalaPaths, runner: CommandRunner): Promise<void> {
  const result = await runner('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsInstallScript(), process.execPath, paths.serviceEntry,
  ])
  if (result.code !== 0) throw new Error(result.stderr.trim() || `Task Scheduler registration failed (${result.code})`)
}

export async function installAutostart(
  paths = resolvePaths(),
  runner: CommandRunner = runCommand,
  platform: NodeJS.Platform = process.platform,
): Promise<AutostartStatus> {
  if (platform !== 'darwin' && platform !== 'win32') throw new Error('Login autostart is supported on macOS and Windows')
  const version = await stageManagedVersion(process.env.HULALA_PACKAGE_SPEC ?? `hulala@${VERSION}`, VERSION, paths, runner)
  await activateManagedVersion(version, paths)
  if (platform === 'darwin') await installMacOS(paths, runner)
  else await installWindows(paths, runner)
  return await getAutostartStatus(paths, runner, platform)
}

export async function uninstallAutostart(
  paths = resolvePaths(),
  runner: CommandRunner = runCommand,
  platform: NodeJS.Platform = process.platform,
): Promise<AutostartStatus> {
  if (platform === 'darwin') {
    if (process.getuid !== undefined) await runner('launchctl', ['bootout', `gui/${process.getuid()}/${MACOS_LABEL}`])
    if (paths.autostartFile !== undefined) await unlink(paths.autostartFile).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  } else if (platform === 'win32') {
    await runner('schtasks.exe', ['/Delete', '/TN', WINDOWS_TASK, '/F'])
  }
  return await getAutostartStatus(paths, runner, platform)
}

export async function restartAutostart(
  paths = resolvePaths(),
  runner: CommandRunner = runCommand,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === 'darwin') {
    if (paths.autostartFile === undefined || process.getuid === undefined) throw new Error('macOS LaunchAgent path is unavailable')
    const domain = `gui/${process.getuid()}`
    await runner('launchctl', ['bootout', `${domain}/${MACOS_LABEL}`])
    const result = await runner('launchctl', ['bootstrap', domain, paths.autostartFile])
    if (result.code !== 0) throw new Error(result.stderr.trim() || `launchctl bootstrap failed (${result.code})`)
    return
  }
  if (platform === 'win32') {
    await runner('schtasks.exe', ['/End', '/TN', WINDOWS_TASK])
    const result = await runner('schtasks.exe', ['/Run', '/TN', WINDOWS_TASK])
    if (result.code !== 0) throw new Error(result.stderr.trim() || `Task Scheduler restart failed (${result.code})`)
    return
  }
  throw new Error('Login autostart is supported on macOS and Windows')
}

export async function getAutostartStatus(
  paths = resolvePaths(),
  runner: CommandRunner = runCommand,
  platform: NodeJS.Platform = process.platform,
): Promise<AutostartStatus> {
  if (platform === 'darwin') {
    const installed = await exists(paths.autostartFile)
    const active = process.getuid !== undefined && (await runner('launchctl', ['print', `gui/${process.getuid()}/${MACOS_LABEL}`])).code === 0
    return { supported: true, installed, active, manager: 'launchd' }
  }
  if (platform === 'win32') {
    const active = (await runner('schtasks.exe', ['/Query', '/TN', WINDOWS_TASK])).code === 0
    return { supported: true, installed: active, active, manager: 'task-scheduler' }
  }
  return { supported: false, installed: false, active: false, manager: 'unsupported' }
}
