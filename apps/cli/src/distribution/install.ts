import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { verifyPackage, type PackageManifest } from '@hulala/distribution/manifest'
import type { PathRegistration } from './path.js'

export interface InstalledVersion { id: string; version: string; manifestSha256: string; dataFormat: number }
export interface ActiveInstallation { format: 1; current: InstalledVersion; previous?: InstalledVersion }
export interface InstallationReceipt { format: 1; product: 'hulala-install'; command: string; launcherSha256: string; createdAt: string; pathRegistration?: PathRegistration }
export type CandidateValidator = (directory: string, version: string) => Promise<void>
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const versionId = /^[0-9A-Za-z][0-9A-Za-z.-]{0,160}$/
async function readJson(path: string): Promise<any> { return JSON.parse(await readFile(path, 'utf8')) }
async function atomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = path + '.' + randomUUID() + '.tmp'
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}
function validateVersion(value: any): InstalledVersion {
  if (!value || typeof value.id !== 'string' || !versionId.test(value.id) || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.version) || !/^[a-f0-9]{64}$/.test(value.manifestSha256) || !Number.isInteger(value.dataFormat) || value.dataFormat < 1) throw new Error('Invalid installed version record')
  return value
}
export async function readInstallation(root: string): Promise<ActiveInstallation> {
  const value = await readJson(join(root, 'active.json'))
  if (value.format !== 1) throw new Error('Unsupported installation format')
  return { format: 1, current: validateVersion(value.current), ...(value.previous ? { previous: validateVersion(value.previous) } : {}) }
}
export async function installationReceipt(root: string): Promise<InstallationReceipt> {
  const value = await readJson(join(root, 'installation.json'))
  if (value.format !== 1 || value.product !== 'hulala-install' || typeof value.command !== 'string' || !isAbsolute(value.command) || !/^[a-f0-9]{64}$/.test(value.launcherSha256 || '')) throw new Error('Invalid Hulala installation receipt')
  return value
}
export function installedDirectory(root: string, version: InstalledVersion): string { return join(root, 'versions', validateVersion(version).id) }
export async function verifyInstalled(root: string, version: InstalledVersion): Promise<PackageManifest> {
  const directory = installedDirectory(root, version)
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Installed version may not be a symlink')
  const manifest = await verifyPackage(directory)
  if (manifest.stage !== 'workbench' || manifest.version !== version.version || manifest.dataFormat !== version.dataFormat
    || digest(await readFile(join(directory, 'manifest.json'))) !== version.manifestSha256) throw new Error('Installed version does not match its receipt')
  return manifest
}
export async function withInstallationLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const lock = join(root, '.operation-lock'), nonce = randomUUID(), deadline = Date.now() + 120000
  for (;;) {
    try { await mkdir(lock, { mode: 0o700 }); break }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = await lstat(lock).catch(() => null)
      if (!info) continue
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Invalid installation lock')
      let alive = true
      try {
        const owner = await readJson(join(lock, 'owner.json'))
        if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('Invalid lock owner')
        try { process.kill(owner.pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw error }
      } catch (error) { if (!missing(error)) throw error; if (Date.now() - info.mtimeMs > 10000) alive = false }
      if (!alive) { await rm(lock, { recursive: true, force: true }); continue }
      if (Date.now() >= deadline) throw new Error('Another Hulala installation operation is still running')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  try { await atomic(join(lock, 'owner.json'), { pid: process.pid, nonce }); return await action() }
  finally {
    const owner = await readJson(join(lock, 'owner.json')).catch(() => null)
    if (owner?.nonce === nonce) await rm(lock, { recursive: true, force: true })
  }
}
/**
 * The command file names its own installation root. Nothing outside the Hulala
 * state root has to describe where the program lives, and `hulala uninstall`
 * recognizes the file by this marker instead of a second locator file that
 * could disagree with it. The command is a shell script because it has to pick
 * the Node runtime itself; older installations used a Node script, so both
 * comment markers are recognized.
 */
const LAUNCHER_MARKERS = ['# hulala-launcher ', '// hulala-launcher '] as const
export function launcherRoot(source: string): string | undefined {
  const lines = source.slice(0, 4096).split('\n')
  for (const marker of LAUNCHER_MARKERS) {
    const line = lines.find(value => value.startsWith(marker))
    if (line === undefined) continue
    let value: any
    try { value = JSON.parse(line.slice(marker.length)) } catch { continue }
    if (value?.format !== 1 || typeof value.root !== 'string' || !isAbsolute(value.root)) continue
    return resolve(value.root)
  }
  return undefined
}
/**
 * The command in `bin/hulala` and the program it starts. The command is POSIX
 * shell so it can find a runtime before any JavaScript exists: the installer's
 * standalone Node in `<state root>/runtime/node` wins, then a `node` on `PATH`,
 * and a too-old candidate is skipped instead of producing a shebang error. The
 * program stays JavaScript because it owns the `active.json` read, the signal
 * forwarding and the environment the installed version runs with.
 */
function launcherScript(root: string, stateRoot: string): string {
  const marker = `${LAUNCHER_MARKERS[0]}${JSON.stringify({ format: 1, root, state: stateRoot })}`
  return `#!/bin/sh
${marker}
set -eu
root=${JSON.stringify(root)}
state=${JSON.stringify(stateRoot)}
# The floor is DeepSeek Harness's own engines field (@deepseek-ai/dsh), which
# the Host boots in process; it moves when DSH moves.
node_usable() {
  version=$("$1" --version 2>/dev/null) || return 1
  case "$version" in v[0-9]*) ;; *) return 1 ;; esac
  version=\${version#v}
  major=\${version%%.*}
  rest=\${version#*.}
  minor=\${rest%%.*}
  minor=\${minor%%[!0-9]*}
  [ -n "$minor" ] || minor=0
  case "$major$minor" in ''|*[!0-9]*) return 1 ;; esac
  if [ "$major" -gt 24 ]; then return 0; fi
  if [ "$major" -lt 24 ]; then return 1; fi
  if [ "$minor" -ge 9 ]; then return 0; fi
  return 1
}
# The installer's Node lives inside the state root. Releases 0.2.14 to 0.2.16
# unpacked it into the shared data directory instead; that directory is still
# recognized for those installations.
installed=''
if [ -f "$state/runtime/node/CURRENT" ]; then
  name=$(cat "$state/runtime/node/CURRENT" 2>/dev/null) || name=''
  case "$name" in
    ''|.*|*[!0-9A-Za-z._-]*) ;;
    *)
      # The stable entry point next to CURRENT is preferred because its
      # directory also holds the npm script the release install uses; a runtime
      # unpacked by an older installer only has the version directory.
      if [ -x "$state/runtime/node/bin/node" ]; then installed=$state/runtime/node/bin/node
      elif [ -x "$state/runtime/node/$name/bin/node" ]; then installed=$state/runtime/node/$name/bin/node
      fi ;;
  esac
fi
if [ -z "$installed" ] && [ -x "\${XDG_DATA_HOME:-$HOME/.local/share}/hulala-node/bin/node" ]; then
  installed="\${XDG_DATA_HOME:-$HOME/.local/share}/hulala-node/bin/node"
fi
node=''
for candidate in "$installed" "$(command -v node 2>/dev/null || true)"; do
  [ -n "$candidate" ] || continue
  if node_usable "$candidate"; then node=$candidate; break; fi
done
if [ -z "$node" ]; then
  echo 'Hulala needs Node.js 24.9 or newer. Reinstall it with: curl -fsSL https://hulala.ai/install.sh | sh' >&2
  exit 1
fi
PATH=\${node%/*}:$PATH
export PATH
exec "$node" "$root/launcher.mjs" "$@"
`
}
function launcherProgram(root: string): string { return `import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
const root = ${JSON.stringify(root)}
try {
  const active = JSON.parse(await readFile(join(root, 'active.json'), 'utf8'))
  const directory = join(root, 'versions', active.current.id)
  const executable = join(directory, 'bin', process.platform === 'win32' ? 'hulala.exe' : 'hulala')
  const child = spawn(executable, process.argv.slice(2), {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, HULALA_PACKAGE_ROOT: directory, HULALA_INSTALL_ROOT: root, HULALA_INSTALL_SOURCE: 'standalone', HULALA_LAUNCHER_PID: String(process.pid) },
  })
  const forward = signal => { child.kill(signal) }
  process.on('SIGINT', forward)
  process.on('SIGTERM', forward)
  child.once('error', error => { console.error(error.message); process.exitCode = 1 })
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', forward)
    process.removeListener('SIGTERM', forward)
    if (signal) process.kill(process.pid, signal)
    else process.exitCode = code ?? 1
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
` }

export class Installation {
  readonly root: string
  constructor(root: string, readonly stateRoot: string) {
    if (!isAbsolute(root) || !isAbsolute(stateRoot)) throw new Error('Installation and state paths must be absolute')
    this.root = resolve(root)
    if (this.root === resolve(stateRoot)) throw new Error('The program directory must be separate from user data')
  }
  private async dataFormat(): Promise<number> {
    try {
      const value = await readJson(join(this.stateRoot, 'server/browser-data-format.json'))
      if (!Number.isInteger(value.format) || value.format < 1) throw new Error('Invalid browser data format marker')
      return value.format
    } catch (error) { if (missing(error)) return 1; throw error }
  }
  async checkData(version: InstalledVersion): Promise<void> {
    if (version.dataFormat < await this.dataFormat()) throw new Error('This version cannot read the current user data format. Restore a compatible backup before rolling back.')
  }
  async stage(source: string, validate: CandidateValidator): Promise<InstalledVersion> {
    const nesting = relative(resolve(source), this.root)
    if (!nesting || (!nesting.startsWith('..' + sep) && nesting !== '..' && !isAbsolute(nesting))) throw new Error('Install outside the extracted package directory')
    const manifest = await verifyPackage(source)
    if (manifest.stage !== 'workbench' || manifest.target !== `${process.platform}-${process.arch}`) throw new Error('This package is not compatible with this computer')
    const sha = digest(await readFile(join(source, 'manifest.json')))
    const version: InstalledVersion = { id: manifest.version + '-' + sha.slice(0, 24), version: manifest.version, manifestSha256: sha, dataFormat: manifest.dataFormat! }
    await this.checkData(version)
    const destination = installedDirectory(this.root, version)
    try { await verifyInstalled(this.root, version); return version }
    catch (error) { if (!missing(error)) throw error }
    await mkdir(join(this.root, 'versions'), { recursive: true, mode: 0o700 })
    const staging = await mkdtemp(join(this.root, 'versions/.staging-'))
    try {
      await cp(source, staging, { recursive: true, dereference: false })
      await verifyPackage(staging)
      await validate(staging, manifest.version)
      const deadline = Date.now() + 5000
      for (;;) {
        try { await rename(staging, destination); break }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code || ''
          const windowsLock = process.platform === 'win32' && code === 'EPERM'
          if (!['EEXIST', 'ENOTEMPTY'].includes(code) && !windowsLock) throw error
          // A racing installer may have committed this exact package. Windows
          // can also retain an executable mapping briefly after candidate exit.
          try { await verifyInstalled(this.root, version); break }
          catch (verification) { if (!missing(verification)) throw verification }
          if (!windowsLock || Date.now() >= deadline) throw error
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      return version
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
  async activate(version: InstalledVersion): Promise<ActiveInstallation> {
    await verifyInstalled(this.root, version); await this.checkData(version)
    let before: ActiveInstallation | undefined
    try { before = await readInstallation(this.root) } catch (error) { if (!missing(error)) throw error }
    if (before?.current.id === version.id) return before
    const active: ActiveInstallation = { format: 1, current: version, ...(before ? { previous: before.current } : {}) }
    await atomic(join(this.root, 'active.json'), active)
    return active
  }
  /**
   * Write the real command into Hulala's own `bin` directory and, when the
   * command belongs somewhere else on the user's PATH, publish it as a symlink
   * to that file. The link is the only thing outside the state root, the state
   * root keeps a real file, and an update rewrites that file in place so the
   * link never needs to change.
   */
  /** The real command file inside Hulala's own bin directory, canonicalized. */
  private async commandFile(name: string): Promise<string> {
    const directory = join(this.stateRoot, 'bin')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    return join(await realpath(directory), name)
  }
  async installLauncher(command: string): Promise<void> {
    if (!isAbsolute(command)) throw new Error('The command path must be absolute')
    await mkdir(dirname(command), { recursive: true, mode: 0o700 })
    command = join(await realpath(dirname(command)), basename(command))
    const real = await this.commandFile(basename(command))
    const script = launcherScript(this.root, this.stateRoot)
    let before: InstallationReceipt | undefined
    try { before = await installationReceipt(this.root) } catch (error) { if (!missing(error)) throw error }
    // The program the command starts is version-independent, so it is written
    // once per launcher update and never differs between installed versions.
    const program = join(this.root, 'launcher.mjs'), programTemporary = program + '.' + randomUUID() + '.tmp'
    try { await writeFile(programTemporary, launcherProgram(this.root), { mode: 0o600 }); await rename(programTemporary, program) }
    finally { await rm(programTemporary, { force: true }) }
    const temporary = real + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temporary, script, { mode: 0o755 })
      const receipt: InstallationReceipt = { format: 1, product: 'hulala-install', command, launcherSha256: digest(script), createdAt: before?.createdAt ?? new Date().toISOString(), ...(before?.pathRegistration ? { pathRegistration: before.pathRegistration } : {}) }
      await atomic(join(this.root, 'installation.json'), receipt)
      await rename(temporary, real)
    } finally { await rm(temporary, { force: true }) }
    if (command === real) return
    // Anything at the PATH location that neither is Hulala's link nor names
    // this installation belongs to another program and is left alone.
    const existing = await lstat(command).catch(error => { if (missing(error)) return undefined; throw error })
    if (existing !== undefined) {
      if (existing.isDirectory()) throw new Error(`${command} is a directory; remove it or install with --bin <directory>`)
      const linked = existing.isSymbolicLink() ? resolve(dirname(command), await readlink(command)) : undefined
      if (linked === real) return
      const owned = linked === undefined && existing.isFile() && launcherRoot(await readFile(command, 'utf8').catch(() => '')) === this.root
      if (!owned) throw new Error(`${command} belongs to another program. Remove it, or install with --bin <directory>, then run the installer again.`)
      await rm(command)
    }
    await symlink(real, command)
  }
  async rollback(validate: CandidateValidator): Promise<ActiveInstallation> {
    const active = await readInstallation(this.root)
    if (!active.previous) throw new Error('No previous installed version is available')
    await verifyInstalled(this.root, active.previous); await this.checkData(active.previous)
    await validate(installedDirectory(this.root, active.previous), active.previous.version)
    return this.activate(active.previous)
  }
  async restore(active: ActiveInstallation): Promise<void> {
    await verifyInstalled(this.root, active.current); await this.checkData(active.current)
    await atomic(join(this.root, 'active.json'), active)
  }
  /**
   * Delete version directories nothing can reach any more. An update only ever
   * starts the active version, and `rollback` only needs the previous one, so
   * keeping those plus a version still running in another terminal bounds the
   * disk an installation uses. Unrecognized or damaged directories are left
   * alone, as `uninstall` does.
   */
  async prune(active: ActiveInstallation, running: readonly string[] = []): Promise<string[]> {
    const retained = new Set([active.current.id, ...(active.previous ? [active.previous.id] : []), ...running])
    const preserved: string[] = []
    for (const entry of await readdir(join(this.root, 'versions'), { withFileTypes: true })) {
      if (!entry.isDirectory() || !versionId.test(entry.name) || retained.has(entry.name)) continue
      const directory = join(this.root, 'versions', entry.name)
      try { await verifyPackage(directory) } catch { preserved.push(directory); continue }
      // A version another process still has open may refuse removal; the next
      // update tries again instead of failing this one.
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => { preserved.push(directory) })
    }
    return preserved
  }
  async rememberPath(registration: PathRegistration): Promise<void> {
    await atomic(join(this.root, 'installation.json'), { ...await installationReceipt(this.root), pathRegistration: registration })
  }
  async assertLauncherOwned(): Promise<InstallationReceipt> {
    const receipt = await installationReceipt(this.root)
    const real = await this.commandFile(basename(receipt.command))
    const source = await readFile(real, 'utf8').catch(() => undefined)
    if (source === undefined || launcherRoot(source) !== this.root) throw new Error('The launcher was replaced; refusing to remove a file owned by another installation')
    const existing = await lstat(receipt.command).catch(() => undefined)
    if (existing === undefined) throw new Error('The launcher was removed; refusing to remove program files without it')
    if (existing.isSymbolicLink() && resolve(dirname(receipt.command), await readlink(receipt.command)) !== real)
      throw new Error('The launcher was replaced; refusing to remove a file owned by another installation')
    return receipt
  }
  async uninstall(): Promise<{ preserved: string[] }> {
    const receipt = await this.assertLauncherOwned()
    const preserved: string[] = []
    for (const entry of await readdir(join(this.root, 'versions'), { withFileTypes: true })) {
      const directory = join(this.root, 'versions', entry.name)
      if (!entry.isDirectory() || !versionId.test(entry.name)) { preserved.push(directory); continue }
      try {
        const manifest = await verifyPackage(directory)
        const hash = digest(await readFile(join(directory, 'manifest.json')))
        if (entry.name !== manifest.version + '-' + hash.slice(0, 24)) throw new Error('Unknown directory')
      } catch { preserved.push(directory); continue }
      // A valid package that cannot be removed is an IO failure, not user work
      // to silently preserve while claiming that uninstall succeeded.
      await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    }
    if ((await lstat(receipt.command)).isSymbolicLink()) await rm(receipt.command)
    const real = await this.commandFile(basename(receipt.command))
    await rm(real, { force: true })
    await rm(join(this.root, 'launcher.mjs'), { force: true })
    for (const file of ['active.json', 'installation.json']) await rm(join(this.root, file), { force: true })
    // The Node runtime the installer supplied belongs to this installation too;
    // it is only removed when Hulala itself put it there.
    const installedNode = join(this.stateRoot, 'runtime/node')
    if (await stat(join(installedNode, 'CURRENT')).then(() => true, () => false)) await rm(installedNode, { recursive: true, force: true })
    // 0.2.14 to 0.2.16 unpacked that runtime into the shared data directory; it
    // is still Hulala's, so uninstalling removes it as well.
    const sharedNode = join(process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local/share'), 'hulala-node')
    if (await stat(join(sharedNode, 'CURRENT')).then(() => true, () => false)) await rm(sharedNode, { recursive: true, force: true })
    // Leave the state root's bin directory only when the command was the last
    // thing in it; the bundled nvim and helpers live there too.
    await rm(dirname(real), { recursive: false }).catch(() => {})
    return { preserved }
  }
}
