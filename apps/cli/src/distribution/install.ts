import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
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
export async function launcherInstallation(executable: string): Promise<string | undefined> {
  executable = await realpath(executable)
  let value: any
  try { value = await readJson(join(dirname(executable), '.hulala-launcher.json')) } catch (error) { if (missing(error)) return; throw error }
  if (value.format !== 1 || value.product !== 'hulala-launcher' || typeof value.root !== 'string' || !isAbsolute(value.root)) throw new Error('Invalid launcher installation location')
  const receipt = await installationReceipt(value.root)
  if (await realpath(receipt.command) !== executable) throw new Error('Launcher does not belong to this installation')
  return value.root
}
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
      try { await rename(staging, destination) }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) throw error; await verifyInstalled(this.root, version) }
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
  async installLauncher(command: string, version: InstalledVersion): Promise<void> {
    if (!isAbsolute(command)) throw new Error('The command path must be absolute')
    await mkdir(dirname(command), { recursive: true, mode: 0o700 })
    command = join(await realpath(dirname(command)), basename(command))
    const source = join(installedDirectory(this.root, version), 'bin', process.platform === 'win32' ? 'hulala.exe' : 'hulala')
    const locator = join(dirname(command), '.hulala-launcher.json')
    let existing: InstallationReceipt | undefined
    try { existing = await installationReceipt(this.root) } catch (error) { if (!missing(error)) throw error }
    if (existing) {
      if (resolve(existing.command) !== resolve(command) || digest(await readFile(command)) !== existing.launcherSha256) throw new Error('The existing launcher was moved or replaced; refusing to overwrite it')
      return
    }
    for (const path of [command, locator]) {
      try { await lstat(path); throw new Error('The command location is already occupied: ' + path) }
      catch (error) { if (!missing(error)) throw error }
    }
    await mkdir(dirname(command), { recursive: true, mode: 0o700 })
    const temporary = command + '.' + randomUUID() + '.tmp'
    try {
      await cp(source, temporary)
      const receipt: InstallationReceipt = { format: 1, product: 'hulala-install', command: resolve(command), launcherSha256: digest(await readFile(temporary)), createdAt: new Date().toISOString() }
      await atomic(join(this.root, 'installation.json'), receipt)
      await atomic(locator, { format: 1, product: 'hulala-launcher', root: this.root })
      await rename(temporary, command)
    } finally { await rm(temporary, { force: true }) }
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
  async rememberPath(registration: PathRegistration): Promise<void> {
    await atomic(join(this.root, 'installation.json'), { ...await installationReceipt(this.root), pathRegistration: registration })
  }
  async assertLauncherOwned(): Promise<InstallationReceipt> {
    const receipt = await installationReceipt(this.root)
    if ((await lstat(receipt.command)).isSymbolicLink() || digest(await readFile(receipt.command)) !== receipt.launcherSha256) throw new Error('The launcher was replaced; refusing to remove a file owned by another installation')
    if (await launcherInstallation(receipt.command) !== this.root) throw new Error('The launcher belongs to another installation')
    return receipt
  }
  async uninstall(): Promise<{ preserved: string[] }> {
    const receipt = await this.assertLauncherOwned()
    await rm(receipt.command)
    await rm(join(dirname(receipt.command), '.hulala-launcher.json'))
    const preserved: string[] = []
    for (const entry of await readdir(join(this.root, 'versions'), { withFileTypes: true })) {
      const directory = join(this.root, 'versions', entry.name)
      if (!entry.isDirectory() || !versionId.test(entry.name)) { preserved.push(directory); continue }
      try {
        const manifest = await verifyPackage(directory)
        const hash = digest(await readFile(join(directory, 'manifest.json')))
        if (entry.name !== manifest.version + '-' + hash.slice(0, 24)) throw new Error('Unknown directory')
        await rm(directory, { recursive: true, force: true })
      } catch { preserved.push(directory) }
    }
    for (const file of ['active.json', 'installation.json']) await rm(join(this.root, file), { force: true })
    return { preserved }
  }
}
