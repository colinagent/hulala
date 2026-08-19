import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { VERSION } from './constants.js'
import { resolvePaths, type HulalaPaths } from './paths.js'

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>

export const runCommand: CommandRunner = async (command, args) => await new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => { stdout += String(chunk) })
  child.stderr?.on('data', chunk => { stderr += String(chunk) })
  child.once('error', reject)
  child.once('exit', code => resolve({ code: code ?? 1, stdout, stderr }))
})

export interface ManagedVersion {
  version: string
  entry: string
  installedAt: string
}

export interface ActiveManifest extends ManagedVersion {
  previous?: ManagedVersion
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

export function stableLauncherSource(): string {
  return `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
const manifestPath = new URL('./active.json', import.meta.url);
let stopping = false;
let child;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child?.kill(signal); });
while (true) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  child = spawn(process.execPath, [manifest.entry, '__watchdog'], { stdio: 'inherit', env: { ...process.env, HULALA_MANAGED_VERSION: manifest.version } });
  const result = await new Promise((resolve) => { child.once('error', () => resolve({ code: 1, signal: null })); child.once('exit', (code, signal) => resolve({ code, signal })); });
  if (stopping || result.code === 0) process.exit(result.code ?? 0);
  if (!manifest.previous) process.exit(result.code ?? 1);
  const rollback = { ...manifest.previous };
  const temporary = new URL('./active.rollback.tmp', import.meta.url);
  await writeFile(temporary, JSON.stringify(rollback, null, 2));
  await rename(temporary, manifestPath);
}
`
}

export async function ensureStableLauncher(paths = resolvePaths()): Promise<void> {
  await mkdir(paths.serviceRoot, { recursive: true })
  await atomicWrite(paths.serviceEntry, stableLauncherSource())
}

export async function readActiveManifest(paths = resolvePaths()): Promise<ActiveManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(paths.activeManifest, 'utf8')) as Partial<ActiveManifest>
    if (typeof value.version !== 'string' || typeof value.entry !== 'string' || typeof value.installedAt !== 'string') return undefined
    return value as ActiveManifest
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function stageManagedVersion(
  packageSpec = process.env.HULALA_PACKAGE_SPEC ?? `hulala@${VERSION}`,
  expectedVersion = VERSION,
  paths = resolvePaths(),
  runner: CommandRunner = runCommand,
): Promise<ManagedVersion> {
  await mkdir(paths.versionsRoot, { recursive: true })
  const safeVersion = expectedVersion.replace(/[^a-zA-Z0-9._-]/g, '_')
  const destination = join(paths.versionsRoot, safeVersion)
  const destinationEntry = join(destination, 'node_modules', 'hulala', 'dist', 'cli.js')
  if (await exists(destinationEntry)) {
    return { version: expectedVersion, entry: destinationEntry, installedAt: new Date().toISOString() }
  }

  const staging = join(paths.versionsRoot, `.staging-${safeVersion}-${randomUUID()}`)
  try {
    await mkdir(staging, { recursive: true })
    await writeFile(join(staging, 'package.json'), JSON.stringify({ private: true }, null, 2), 'utf8')
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const install = await runner(npm, ['install', '--prefix', staging, '--omit=dev', '--no-audit', '--no-fund', '--save-exact', packageSpec])
    if (install.code !== 0) throw new Error(install.stderr.trim() || `npm install failed (${install.code})`)
    const packagePath = join(staging, 'node_modules', 'hulala', 'package.json')
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { version?: unknown }
    if (packageJson.version !== expectedVersion) throw new Error(`Downloaded version ${String(packageJson.version)} does not match ${expectedVersion}`)
    const lock = JSON.parse(await readFile(join(staging, 'package-lock.json'), 'utf8')) as {
      packages?: Record<string, { version?: unknown; integrity?: unknown }>
    }
    const lockedPackage = Object.entries(lock.packages ?? {}).find(([key, value]) =>
      (key === 'node_modules/hulala' || key.replaceAll('\\', '/').endsWith('/node_modules/hulala'))
      && value.version === expectedVersion,
    )?.[1]
    if (typeof lockedPackage?.integrity !== 'string' || !/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(lockedPackage.integrity)) {
      throw new Error('Downloaded package has no verified npm integrity record')
    }
    const entry = join(staging, 'node_modules', 'hulala', 'dist', 'cli.js')
    if (!await exists(entry)) throw new Error('Downloaded package has no Hulala CLI entry')
    const versionCheck = await runner(process.execPath, [entry, '--version'])
    if (versionCheck.code !== 0 || versionCheck.stdout.trim() !== expectedVersion) {
      throw new Error(versionCheck.stderr.trim() || 'Downloaded package failed its CLI validation')
    }
    try {
      await rename(staging, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
    }
    return { version: expectedVersion, entry: destinationEntry, installedAt: new Date().toISOString() }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

export async function activateManagedVersion(version: ManagedVersion, paths = resolvePaths()): Promise<ActiveManifest> {
  await ensureStableLauncher(paths)
  const current = await readActiveManifest(paths)
  const manifest: ActiveManifest = {
    ...version,
    ...(current === undefined || current.entry === version.entry ? {} : {
      previous: { version: current.version, entry: current.entry, installedAt: current.installedAt },
    }),
  }
  await atomicWrite(paths.activeManifest, JSON.stringify(manifest, null, 2))
  return manifest
}

export async function rollbackManagedVersion(paths = resolvePaths()): Promise<ActiveManifest | undefined> {
  const current = await readActiveManifest(paths)
  if (current?.previous === undefined) return current
  const rollback: ActiveManifest = { ...current.previous }
  await atomicWrite(paths.activeManifest, JSON.stringify(rollback, null, 2))
  return rollback
}
