import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

import { VERSION } from './constants.js'
import {
  activateManagedVersion,
  readActiveManifest,
  rollbackManagedVersion,
  runCommand,
  stageManagedVersion,
  type ActiveManifest,
  type CommandRunner,
  type ManagedVersion,
} from './managed-runtime.js'
import { resolvePaths, type LoopWithAIPaths } from './paths.js'

export interface UpdateStatus {
  currentVersion: string
  latestVersion?: string
  available: boolean
  error?: string
}

function versionParts(version: string): { core: number[]; prerelease?: string } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version)
  if (match === null) return undefined
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], ...(match[4] === undefined ? {} : { prerelease: match[4] }) }
}

export function isNewerVersion(candidate: string, current = VERSION): boolean {
  const left = versionParts(candidate)
  const right = versionParts(current)
  if (left === undefined || right === undefined) return false
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return (left.core[index] ?? 0) > (right.core[index] ?? 0)
  }
  if (left.prerelease === right.prerelease) return false
  if (left.prerelease === undefined) return true
  if (right.prerelease === undefined) return false
  return left.prerelease.localeCompare(right.prerelease, undefined, { numeric: true }) > 0
}

export async function checkForUpdate(fetchImpl: typeof fetch = fetch): Promise<UpdateStatus> {
  try {
    const endpoint = process.env.LOOPWITHAI_UPDATE_URL ?? 'https://registry.npmjs.org/loopwithai/latest'
    const response = await fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) })
    if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`)
    const value = await response.json() as { version?: unknown }
    if (typeof value.version !== 'string') throw new Error('registry response has no version')
    return { currentVersion: VERSION, latestVersion: value.version, available: isNewerVersion(value.version) }
  } catch (error) {
    return { currentVersion: VERSION, available: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Could not allocate a validation port')
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

export async function validateManagedVersionStartup(version: ManagedVersion, timeoutMs = 60_000): Promise<void> {
  const [launcherPort, workbenchPort] = await Promise.all([freePort(), freePort()])
  const child = spawn(process.execPath, [version.entry, '--foreground'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LOOPWITHAI_NO_OPEN: '1',
      LOOPWITHAI_PORT: String(launcherPort),
      LOOPWITHAI_WORKBENCH_PORT: String(workbenchPort),
    },
  })
  let output = ''
  child.stdout?.on('data', chunk => { output = `${output}${String(chunk)}`.slice(-32_768) })
  child.stderr?.on('data', chunk => { output = `${output}${String(chunk)}`.slice(-32_768) })
  let exited = false
  const exitPromise = new Promise<void>(resolve => {
    const finish = (): void => { exited = true; resolve() }
    child.once('error', error => { output = `${output}${error.message}`.slice(-32_768); finish() })
    child.once('exit', finish)
  })
  try {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(`http://127.0.0.1:${launcherPort}/api/loopwithai/health`, { signal: AbortSignal.timeout(700) })
        if (response.ok) {
          const health = await response.json() as { name?: unknown; version?: unknown; workbench?: { state?: unknown } }
          if (health.name === 'loopwithai' && health.version === version.version && health.workbench?.state === 'running') return
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`Version ${version.version} failed its isolated startup check${output.trim() ? `: ${output.trim()}` : ''}`)
  } finally {
    if (!exited) child.kill('SIGTERM')
    let timeout: NodeJS.Timeout | undefined
    await Promise.race([exitPromise, new Promise<void>(resolve => { timeout = setTimeout(resolve, 5_000) })])
    if (timeout !== undefined) clearTimeout(timeout)
    if (!exited) { child.kill('SIGKILL'); await exitPromise }
  }
}

export async function applyManagedUpdate(
  targetVersion: string,
  packageSpec = `loopwithai@${targetVersion}`,
  paths: LoopWithAIPaths = resolvePaths(),
  runner: CommandRunner = runCommand,
  validator: (version: ManagedVersion) => Promise<void> = validateManagedVersionStartup,
): Promise<ActiveManifest> {
  const before = await readActiveManifest(paths)
  let activated = false
  try {
    const staged = await stageManagedVersion(packageSpec, targetVersion, paths, runner)
    await validator(staged)
    const manifest = await activateManagedVersion(staged, paths)
    activated = true
    return manifest
  } catch (error) {
    if (activated && before !== undefined) await rollbackManagedVersion(paths)
    throw error
  }
}
