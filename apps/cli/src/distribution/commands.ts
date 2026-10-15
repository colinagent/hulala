import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { VERSION, APP_URL } from '../constants.js'
import { resolvePaths } from '../paths.js'
import { shutdownInstallation } from '../lifecycle.js'
import { downloadArchive, unpackRelease } from '@hulala/distribution/archive'
import { Installation, installedDirectory, installationReceipt, readInstallation, withInstallationLock } from './install.js'
import { validateNativeCandidate } from './validate.js'
import { verifyPackage } from '@hulala/distribution/manifest'
import { addCommandPath, removeCommandPath } from './path.js'
import { compareVersions, selectRelease } from '@hulala/distribution/channels'
import { fileSha256 } from '@hulala/distribution/archive'
import { autostartBelongsTo, restartAutostart, uninstallAutostart } from '../autostart.js'
import { deferWindowsUninstall } from './deferred-uninstall.js'
import { probeHealth } from '../health.js'
import { installationIdentity } from '../lifecycle.js'

interface Options { root?: string; bin?: string; from?: string; sha256?: string; force: boolean; addToPath: boolean; version?: string; channel?: string }
function options(args: string[]): Options {
  const value: Options = { force: false, addToPath: false }
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!
    if (key === '--force') value.force = true
    else if (key === '--add-to-path') value.addToPath = true
    else if (['--root', '--bin', '--from', '--sha256', '--version', '--channel'].includes(key)) {
      const next = args[++index]
      if (!next || next.startsWith('--')) throw new Error('Missing value for ' + key)
      ;(value as any)[key.slice(2)] = next
    } else throw new Error('Unknown installation option: ' + key)
  }
  if (value.version && !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.version)) throw new Error('Use an explicit semantic version')
  if (value.channel && !['stable', 'preview'].includes(value.channel)) throw new Error('Channel must be stable or preview')
  return value
}
function owner(): string { return process.env.HULALA_INSTALL_SOURCE || 'source' }
function managerInstructions(version = 'latest'): string | undefined {
  const source = owner()
  if (!['npm', 'npx', 'bun', 'pnpm'].includes(source)) return
  const command = source === 'npx' ? `npx hulala@${version}` : source === 'bun' ? `bun install -g hulala@${version}` : source === 'pnpm' ? `pnpm add -g hulala@${version}` : `npm install -g hulala@${version}`
  return `This installation is managed by ${source}. Run:\n${source === 'npx' ? `npx hulala@${version} service shutdown` : 'hulala service shutdown'}\n${command}${source === 'npx' ? '' : '\nhulala'}`
}
async function runVersion(directory: string): Promise<void> {
  const executable = join(directory, 'bin', process.platform === 'win32' ? 'hulala.exe' : 'hulala')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['--no-open'], { stdio: 'inherit', windowsHide: true })
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('The updated service did not start')))
  })
}
async function resumeInstallation(root: string, directory: string, version: string): Promise<void> {
  if (await autostartBelongsTo(root)) await restartAutostart()
  else await runVersion(directory)
  const identity = await installationIdentity(root), deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const health = await probeHealth()
    if (health?.installationId === identity && health.version === version && health.workbench?.state === 'running') return
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error('The selected version did not become ready in the existing user state')
}
export async function runDistributionCommand(command: string, args: string[]): Promise<number> {
  const input = options(args), paths = resolvePaths()
  if (command === 'doctor') {
    console.log(JSON.stringify({ version: VERSION, source: owner(), url: APP_URL, logs: paths.launcherLog, state: paths.data,
      package: process.env.HULALA_PACKAGE_ROOT || null, installation: process.env.HULALA_INSTALL_ROOT || null }, null, 2)); return 0
  }
  if (command === 'update') {
    const hint = managerInstructions(input.version || (input.channel === 'preview' ? 'next' : 'latest'))
    if (hint) { console.log(hint); return 0 }
  }
  if (command === 'uninstall' && ['npm', 'npx', 'bun', 'pnpm'].includes(owner())) {
    const source = owner(), uninstall = source === 'npm' ? 'npm uninstall -g hulala' : source === 'bun' ? 'bun remove -g hulala' : source === 'pnpm' ? 'pnpm remove -g hulala' : 'No global package was installed by npx.'
    console.log(`Stop the service with ${source === 'npx' ? `npx hulala@${VERSION} service shutdown` : 'hulala service shutdown'}, then use ${source}:\n${uninstall}\nYour Hulala configuration and Workspaces are retained.`); return 0
  }
  const root = resolve(input.root || process.env.HULALA_INSTALL_ROOT || join(paths.data, 'runtime/install'))
  const install = new Installation(root, paths.data)
  if (command !== 'install') await installationReceipt(root)
  return withInstallationLock(root, async () => {
    if (await stat(join(root, 'removal.json')).then(() => true, () => false)) throw new Error('Hulala removal is already in progress; check its completion result before changing this installation')
    if (command === 'uninstall') {
      const receipt = await install.assertLauncherOwned()
      await shutdownInstallation(root, input.force)
      if (await autostartBelongsTo(root)) await uninstallAutostart()
      if (process.platform === 'win32') {
        const result = await deferWindowsUninstall(root, paths.data)
        console.log('Hulala will remove its locked program files after this command exits. User data is retained. Completion result: ' + result)
        return 0
      }
      const result = await install.uninstall()
      if (receipt.pathRegistration && (await readdir(dirname(receipt.command))).length === 0) await removeCommandPath(receipt.pathRegistration)
      console.log('Hulala program and command removed. Configuration, credentials and Workspaces were retained.')
      if (result.preserved.length) console.log('Unrecognized or changed files were retained: ' + result.preserved.join(', '))
      return 0
    }
    if (command === 'rollback') {
      const before = await readInstallation(root)
      if (!before.previous) throw new Error('No previous version is available')
      await install.checkData(before.previous)
      await validateNativeCandidate(installedDirectory(root, before.previous), before.previous.version)
      const running = await shutdownInstallation(root, input.force)
      try {
        const active = await install.activate(before.previous)
        if (running) await resumeInstallation(root, installedDirectory(root, active.current), active.current.version)
        console.log('Rolled back to Hulala ' + active.current.version); return 0
      } catch (error) { await install.restore(before); if (running) await resumeInstallation(root, installedDirectory(root, before.current), before.current.version).catch(() => undefined); throw error }
    }
    let source = input.from || (command === 'install' && !input.version && !input.channel ? process.env.HULALA_PACKAGE_ROOT : undefined)
    let expectedManifest: string | undefined, expectedVersion = input.version, expectedDataFormat: number | undefined
    if (!source) {
      const selected = await selectRelease(input)
      if (command === 'update' && !input.version && compareVersions(selected.release.version, VERSION) <= 0) { console.log('No newer release is available on the selected channel.'); return 0 }
      source = selected.asset.url; input.sha256 = selected.asset.sha256; expectedManifest = selected.asset.manifestSha256; expectedVersion = selected.release.version; expectedDataFormat = selected.release.dataFormat
    }
    const temporaryRoot = join(paths.data, 'cache/install'); await mkdir(temporaryRoot, { recursive: true, mode: 0o700 })
    const temporary = await mkdtemp(join(temporaryRoot, 'prepare-'))
    try {
      if (/^https?:/.test(source)) {
        if (!input.sha256) throw new Error('A download requires --sha256')
        const archive = join(temporary, 'package.tar.gz'); await downloadArchive(source, archive, input.sha256); source = archive
      }
      source = await realpath(resolve(source))
      if ((await stat(source)).isFile()) {
        if (!input.sha256) throw new Error('An archive requires --sha256')
        source = (await unpackRelease(source, temporary, input.sha256)).directory
      }
      const manifest = await verifyPackage(source)
      if ((expectedManifest && await fileSha256(join(source, 'manifest.json')) !== expectedManifest) || (expectedVersion && manifest.version !== expectedVersion) || (expectedDataFormat !== undefined && expectedDataFormat !== manifest.dataFormat)) throw new Error('The package does not match the selected release index')
      const candidate = await install.stage(source, validateNativeCandidate)
      const before = await readInstallation(root).catch(() => undefined)
      const running = command === 'update' ? await shutdownInstallation(root, input.force) : false
      let active
      try {
        active = await install.activate(candidate)
        const receipt = await installationReceipt(root).catch(() => undefined)
        const bin = resolve(input.bin || (receipt ? dirname(receipt.command) : join(homedir(), '.local/bin')))
        await install.installLauncher(join(bin, process.platform === 'win32' ? 'hulala.exe' : 'hulala'), active.current)
        if (input.addToPath) { const registration = await addCommandPath(bin, homedir()); if (registration) await install.rememberPath(registration) }
        if (running) await resumeInstallation(root, installedDirectory(root, active.current), active.current.version)
      } catch (error) { if (before) { await install.restore(before); if (running) await resumeInstallation(root, installedDirectory(root, before.current), before.current.version).catch(() => undefined) }; throw error }
      const receipt = await installationReceipt(root)
      console.log(`Hulala ${active.current.version} ${command === 'install' ? 'installed' : 'updated'}: ${receipt.command}`)
      if (!process.env.PATH?.split(process.platform === 'win32' ? ';' : ':').includes(dirname(receipt.command))) console.log((input.addToPath ? 'Open a new terminal to use hulala. Registered PATH directory: ' : 'Add this directory to PATH (or install with --add-to-path): ') + dirname(receipt.command))
      return 0
    } finally { await rm(temporary, { recursive: true, force: true }) }
  })
}
