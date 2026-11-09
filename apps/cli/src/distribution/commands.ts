import { spawn } from 'node:child_process'
import { open, mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { VERSION } from '../constants.js'
import { inspectHost, stopHost } from '../hostAttach.js'
import { resolvePaths } from '../paths.js'
import { spawnDetached } from '../spawn.js'
import { downloadArchive, unpackRelease, fileSha256 } from '@hulala/distribution/archive'
import { compareVersions, selectRelease } from '@hulala/distribution/channels'
import { releaseTarget } from '@hulala/distribution/targets'
import { verifyPackage } from '@hulala/distribution/manifest'
import { latestRelease, releaseAvailable } from '../update/check.js'
import { packageManagerUpdate, runPackageManagerUpdate, type ManagedSource } from '../update/packageManager.js'
import { Installation, installedDirectory, installationReceipt, readInstallation, withInstallationLock } from './install.js'
import { validateNativeCandidate } from './validate.js'
import { addCommandPath, removeCommandPath, userPathDirectories } from './path.js'
import { deferWindowsUninstall } from './deferred-uninstall.js'
import { listCachedReleases, pruneReleaseCache, writeReleaseSidecar } from './releaseCache.js'
import { ensureRuntimeDependencies, type RuntimeAssets } from './dependencies.js'

/** Show `/Users/me/.local/bin/hulala` as `~/.local/bin/hulala`. */
function displayPath(path: string): string {
  const home = homedir()
  return path.startsWith(home + '/') ? '~' + path.slice(home.length) : path
}

/**
 * Stop the Host when it runs another version than the one just activated.
 *
 * Install, update and rollback are explicit user actions that replace the code
 * under the daemon, and the daemon keeps serving the plugin set it booted with
 * (including bugs a newer release already fixed). The action that changes the
 * installed version therefore owns stopping it; an ordinary client still only
 * attaches, or refuses with `version-mismatch` and names the stop command.
 * @param version - the version that is active after this action.
 * @returns the version that was running and had to be stopped, when any.
 */
async function stopStaleHost(version: string): Promise<string | undefined> {
  const live = await inspectHost().catch(() => ({ state: 'stopped' } as const))
  if (live.state !== 'running' || live.record.version === version) return undefined
  await stopHost().catch(() => 'absent')
  return live.record.version
}

interface Options {
  root?: string; bin?: string; from?: string; sha256?: string; version?: string
  runtimeLock?: string; runtimeLockSha256?: string; runtimePack?: string; runtimePackSha256?: string
  force: boolean; /** Register the command directory on PATH when it is missing there. */ addToPath: boolean
  check: boolean; downloadOnly: boolean; background: boolean
}

/** The release's dependency facts, either from the index or from the installer. */
function runtimeAssets(options: Options): RuntimeAssets | undefined {
  const { runtimeLock, runtimeLockSha256, runtimePack, runtimePackSha256 } = options
  if (runtimeLock === undefined || runtimeLockSha256 === undefined) {
    if (runtimeLock !== undefined) throw new Error('A runtime install needs both --runtime-lock-url and --runtime-lock-sha256')
    return undefined
  }
  return {
    lock: { url: runtimeLock, sha256: runtimeLockSha256 },
    ...(runtimePack === undefined || runtimePackSha256 === undefined
      ? {}
      : { pack: { url: runtimePack, sha256: runtimePackSha256 } }),
  }
}

function options(args: string[]): Options {
  const value: Options = { force: false, addToPath: true, check: false, downloadOnly: false, background: false }
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!
    if (key === '--force') value.force = true
    else if (key === '--add-to-path') value.addToPath = true
    else if (key === '--no-add-to-path') value.addToPath = false
    else if (key === '--check') value.check = true
    else if (key === '--download-only') value.downloadOnly = true
    else if (key === '--background') value.background = true
    else if (['--root', '--bin', '--from', '--sha256', '--version', '--runtime-lock-url', '--runtime-lock-sha256', '--runtime-pack-url', '--runtime-pack-sha256'].includes(key)) {
      const next = args[++index]
      if (!next || next.startsWith('--')) throw new Error('Missing value for ' + key)
      const field = ({ '--runtime-lock-url': 'runtimeLock', '--runtime-lock-sha256': 'runtimeLockSha256', '--runtime-pack-url': 'runtimePack', '--runtime-pack-sha256': 'runtimePackSha256' } as Record<string, string>)[key] ?? key.slice(2)
      ;(value as unknown as Record<string, string>)[field] = next
    } else throw new Error('Unknown installation option: ' + key)
  }
  if (value.version && !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.version)) throw new Error('Use an explicit semantic version')
  return value
}

/** Whether a directory is already reachable through PATH, following symlinked entries. */
async function onPathAlready(directory: string): Promise<boolean> {
  for (const entry of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (entry === '') continue
    if (resolve(entry) === resolve(directory)) return true
    if (await realpath(entry).then(value => value === resolve(directory), () => false)) return true
  }
  return false
}

/**
 * Where a release archive is cached so retries, background prefetch and the
 * foreground update share one resumable file.
 * @param data - the state root.
 * @param version - release version, or undefined when the index was not read.
 * @returns the archive path.
 */
function releaseCachePath(data: string, version: string | undefined): string {
  const name = `${releaseTarget()}-${version ?? 'latest'}.tar.gz`
  return join(data, 'cache', 'releases', version ?? 'latest', name)
}

/**
 * Return a verified archive for this release, downloading only what is missing.
 *
 * The cache is keyed by version and target: a `--download-only` run, a detached
 * background download and a plain `hulala update` all meet there. A cached file
 * whose digest does not match is discarded rather than trusted.
 * @param data - the state root.
 * @param version - release version.
 * @param sha256 - pinned digest from the release index.
 * @param url - archive URL.
 * @returns the archive path.
 */
async function cachedArchive(
  data: string,
  version: string | undefined,
  sha256: string,
  url: string,
  facts: { dataFormat?: number; manifestSha256?: string } = {},
): Promise<string> {
  const archive = releaseCachePath(data, version)
  if (await stat(archive).then(entry => entry.isFile(), () => false)) {
    if (await fileSha256(archive) === sha256) {
      console.log('Using the release package downloaded earlier.')
      return archive
    }
    await rm(archive, { force: true })
  }
  await mkdir(dirname(archive), { recursive: true, mode: 0o700 })
  console.log('Downloading the release package...')
  let lastMilestone = -1
  await downloadArchive(url, archive, sha256, {
    onProgress: (received, total) => {
      if (total === undefined) return
      const milestone = Math.floor((received / total) * 10)
      if (milestone === lastMilestone) return
      lastMilestone = milestone
      console.log(`  ${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB (${milestone * 10}%)`)
    },
  })
  await writeReleaseSidecar(archive, facts).catch(() => undefined)
  return archive
}

function owner(): string { return process.env.HULALA_INSTALL_SOURCE || 'source' }

function managedSource(value = owner()): ManagedSource | undefined {
  return value === 'npm' || value === 'bun' || value === 'pnpm' ? value : undefined
}

/**
 * Offer to start the installed client right away, from `/dev/tty`.
 *
 * `curl … | sh` leaves stdin holding the installer, so the question is asked on
 * the terminal itself, like pi's installer does. Declining (or no terminal, or
 * `HULALA_NO_START=1`) leaves the install finished, and the caller prints how to
 * start it instead: answering the question is the only thing between "installed"
 * and "running", so the instructions must not come first.
 * @param command - absolute path of the installed command.
 * @returns whether the client was started (and has now exited).
 */
async function offerStart(command: string): Promise<boolean> {
  if (process.env.HULALA_NO_START === '1' || !process.stdout.isTTY) return false
  let tty: Awaited<ReturnType<typeof open>>
  try { tty = await open('/dev/tty', 'r+') } catch { return false }
  try {
    process.stdout.write('\nStart Hulala now? [Y/n] ')
    let answer = ''
    let answered = false
    const buffer = Buffer.alloc(1)
    for (;;) {
      const { bytesRead } = await tty.read(buffer, 0, 1, null)
      if (bytesRead === 0) break
      const character = buffer.toString('utf8')
      if (character === '\n') { answered = true; break }
      answer += character
    }
    // A closed terminal is not consent to take over the screen.
    if (!answered) return false
    if (/^(?:n|no)$/i.test(answer.trim())) return false
    const child = spawn(command, [], { stdio: [tty.fd, 'inherit', 'inherit'], windowsHide: true, env: process.env })
    await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.once('error', () => resolve()) })
    return true
  } finally { await tty.close().catch(() => undefined) }
}

/** `hulala update --check` is read-only and never writes the installation. */
async function checkForUpdateCommand(input: Options): Promise<number> {
  const version = input.version ?? await latestRelease()
  if (version === undefined) throw new Error('No release is available for this platform.')
  if (input.version !== undefined && !await releaseAvailable(input.version)) {
    throw new Error(`Hulala ${input.version} is not available for this platform.`)
  }
  if (compareVersions(version, VERSION) > 0) {
    console.log(`Current version: ${VERSION}`)
    console.log(`Latest version: ${version}`)
    console.log('Update available. Run `hulala update`.')
  } else {
    console.log(`Hulala ${VERSION} is up to date.`)
  }
  return 0
}

/** Replace a global npm/bun/pnpm install from inside `hulala update`. */
async function updateManaged(source: ManagedSource, input: Options): Promise<number> {
  let version = input.version
  if (version === undefined) {
    const latest = await latestRelease()
    if (latest === undefined) throw new Error('No release is available for this platform.')
    if (!input.force && compareVersions(latest, VERSION) <= 0) {
      console.log(`Hulala ${VERSION} is already up to date.`)
      return 0
    }
    version = latest
  }
  const update = packageManagerUpdate(source, version)
  console.log(`Updating Hulala from ${VERSION} to ${version} with ${source}...`)
  try {
    await runPackageManagerUpdate(update)
  } catch (error) {
    console.error(`Could not update with ${source}: ${error instanceof Error ? error.message : String(error)}`)
    console.error(`Run this command yourself: ${update.display}`)
    return 1
  }
  console.log(`Hulala ${version} installed with ${source}.`)
  const stopped = await stopStaleHost(version)
  if (stopped !== undefined) console.log(`Stopped the Hulala Host ${stopped}; the next start uses ${version}.`)
  return 0
}

export async function runDistributionCommand(command: string, args: string[]): Promise<number> {
  const input = options(args), paths = resolvePaths()
  if (command === 'doctor') {
    console.log(JSON.stringify({
      version: VERSION,
      source: owner(),
      logs: paths.launcherLog,
      state: paths.data,
      package: process.env.HULALA_PACKAGE_ROOT || null,
      installation: process.env.HULALA_INSTALL_ROOT || null,
    }, null, 2))
    return 0
  }
  if (input.check && command !== 'update') throw new Error('--check is only valid with hulala update')
  if ((input.downloadOnly || input.background) && command !== 'update') throw new Error('--download-only and --background are only valid with hulala update')
  if (command === 'update') {
    const source = owner()
    if (input.check) return await checkForUpdateCommand(input)
    if (source === 'npx') {
      console.log('This Hulala was started by npx and is not installed. Run the latest release with:')
      console.log('  npx hulala@latest')
      return 0
    }
    const managed = managedSource(source)
    if (managed !== undefined) return await updateManaged(managed, input)
    if (input.background) {
      // A detached downloader writes into the same resumable cache a later
      // `hulala update` reads, so the user never waits on 150 MB in the foreground.
      const entry = process.argv[1]
      if (entry === undefined) throw new Error('Cannot start the background download from this entry point')
      const child = spawnDetached(
        process.execPath,
        [entry, 'update', '--download-only', ...(input.version === undefined ? [] : ['--version', input.version])],
        'ignore',
      )
      console.log(`Downloading the next release in the background (pid ${child.pid ?? 'unknown'}).`)
      console.log('Run `hulala update` again when it finishes; it installs from the download without starting over.')
      return 0
    }
  }
  if (command === 'uninstall' && ['npm', 'npx', 'bun', 'pnpm'].includes(owner())) {
    const source = owner()
    const uninstall = source === 'npm' ? 'npm uninstall -g hulala' : source === 'bun' ? 'bun remove -g hulala' : source === 'pnpm' ? 'pnpm remove -g hulala' : 'No global package was installed by npx.'
    console.log(`Stop any running Host with ${source === 'npx' ? `npx hulala@${VERSION} host stop` : 'hulala host stop'}, then use ${source}:\n${uninstall}\nYour Hulala configuration and Workspaces are retained.`)
    return 0
  }
  const root = resolve(input.root || process.env.HULALA_INSTALL_ROOT || join(paths.data, 'runtime/client'))
  const install = new Installation(root, paths.data)
  if (command !== 'install') {
    try {
      await installationReceipt(root)
    } catch (error) {
      // A source checkout has no immutable installation receipt. Point at the
      // checkout and `hulala install` instead of exposing an internal error.
      if (command === 'update' && owner() === 'source') {
        console.log('This Hulala runs from a source checkout. Update the checkout with git, or install a release with `hulala install`.')
        return 0
      }
      throw error
    }
  }
  // Replacing the code under a live daemon ends every attached client, so say it
  // before a download starts rather than only in the last line of output.
  if (command === 'install' || command === 'update' || command === 'rollback') {
    const live = await inspectHost().catch(() => ({ state: 'stopped' } as const))
    if (live.state === 'running') console.log(`The Hulala Host ${live.record.version} is running: it will be stopped, and running turns and attached clients will be interrupted.`)
  }
  return withInstallationLock(root, async () => {
    if (await stat(join(root, 'removal.json')).then(() => true, () => false)) throw new Error('Hulala removal is already in progress; check its completion result before changing this installation')
    // Re-running the installer for a version that is already active must say so
    // instead of claiming a fresh install.
    const beforeVersion = await readInstallation(root).then(value => value.current.version, () => undefined)
    if (command === 'uninstall') {
      const receipt = await install.assertLauncherOwned()
      if (process.platform === 'win32') {
        const result = await deferWindowsUninstall(root, paths.data)
        console.log('Hulala will remove its locked program files after this command exits. User data is retained. Completion result: ' + result)
        return 0
      }
      const result = await install.uninstall()
      if (receipt.pathRegistration) await removeCommandPath(receipt.pathRegistration)
      console.log('Hulala program and command removed. Configuration, credentials and Workspaces were retained.')
      if (result.preserved.length) console.log('Unrecognized or changed files were retained: ' + result.preserved.join(', '))
      return 0
    }
    if (command === 'rollback') {
      const before = await readInstallation(root)
      if (!before.previous) throw new Error('No previous version is available')
      await install.checkData(before.previous)
      await validateNativeCandidate(installedDirectory(root, before.previous), before.previous.version)
      const active = await install.activate(before.previous)
      const stopped = await stopStaleHost(active.current.version)
      console.log('Rolled back to Hulala ' + active.current.version)
      if (stopped !== undefined) console.log(`Stopped the Hulala Host ${stopped}; the next start uses ${active.current.version}.`)
      return 0
    }
    let assets: RuntimeAssets | undefined = runtimeAssets(input)
    let source = input.from || (command === 'install' && !input.version ? process.env.HULALA_PACKAGE_ROOT : undefined)
    let expectedManifest: string | undefined, expectedVersion = input.version, expectedDataFormat: number | undefined
    if (!source) {
      // A prefetch may have left one or more releases here. Install the newest
      // one that exists — the index only has to be reached when the cache does
      // not already hold it.
      const cached = (await listCachedReleases(paths.data)).filter((entry): entry is typeof entry & { sha256: string } => entry.sha256 !== undefined)
      const pinned = input.version === undefined ? undefined : cached.find(entry => entry.version === input.version)
      let indexed: Awaited<ReturnType<typeof selectRelease>> | undefined
      try {
        indexed = await selectRelease({
          channel: 'stable',
          ...(input.version === undefined ? {} : { version: input.version }),
        })
      } catch (error) {
        if (pinned === undefined && cached.length === 0) throw error
        console.log('The release index is unreachable; installing from the downloaded package.')
      }
      const newest = pinned ?? cached[0]
      const chosen = newest !== undefined && (indexed === undefined || compareVersions(newest.version, indexed.release.version) >= 0) ? newest : undefined
      if (chosen !== undefined) {
        if (command === 'update' && !input.version && !input.force && compareVersions(chosen.version, VERSION) <= 0) { console.log(`Hulala ${VERSION} is already up to date.`); return 0 }
        console.log(`Using the downloaded release ${chosen.version}.`)
        source = chosen.archive
        input.sha256 = chosen.sha256
        expectedVersion = chosen.version
        expectedManifest = chosen.manifestSha256
        expectedDataFormat = chosen.dataFormat
      } else if (indexed !== undefined) {
        if (command === 'update' && !input.version && !input.force && compareVersions(indexed.release.version, VERSION) <= 0) { console.log(`Hulala ${VERSION} is already up to date.`); return 0 }
        source = indexed.asset.url; input.sha256 = indexed.asset.sha256; expectedManifest = indexed.asset.manifestSha256; expectedVersion = indexed.release.version; expectedDataFormat = indexed.release.dataFormat
        assets = indexed.asset.runtime
      } else {
        throw new Error('No release is available for this platform.')
      }
    }
    const temporaryRoot = join(paths.data, 'cache/install'); await mkdir(temporaryRoot, { recursive: true, mode: 0o700 })
    const temporary = await mkdtemp(join(temporaryRoot, 'prepare-'))
    try {
      console.log('Preparing installation...')
      if (/^https?:/.test(source)) {
        if (!input.sha256) throw new Error('A download requires --sha256')
        const archive = await cachedArchive(paths.data, expectedVersion, input.sha256, source, {
          ...(expectedDataFormat === undefined ? {} : { dataFormat: expectedDataFormat }),
          ...(expectedManifest === undefined ? {} : { manifestSha256: expectedManifest }),
        })
        if (input.downloadOnly) {
          console.log(`Release package ready: ${archive}`)
          return 0
        }
        source = archive
      }
      source = await realpath(resolve(source))
      if ((await stat(source)).isFile()) {
        console.log('Verifying and extracting the release package...')
        if (!input.sha256) throw new Error('An archive requires --sha256')
        source = (await unpackRelease(source, temporary, input.sha256)).directory
      }
      console.log('Checking package integrity...')
      const manifest = await verifyPackage(source)
      if ((expectedManifest && await fileSha256(join(source, 'manifest.json')) !== expectedManifest) || (expectedVersion && manifest.version !== expectedVersion) || (expectedDataFormat !== undefined && expectedDataFormat !== manifest.dataFormat)) throw new Error('The package does not match the selected release index')
      // The archive carries the code, not its dependency tree: install it after the
      // package proved it is the selected release, so a wrong download never runs
      // anything.
      // npm can be silent for a minute on a cold registry; say it is still moving
      // instead of leaving the terminal looking stuck.
      const dependencyHeartbeat = setInterval(() => console.log('Still installing dependencies...'), 15000)
      let dependencies
      try { dependencies = await ensureRuntimeDependencies(join(source, 'runtime'), assets) }
      finally { clearInterval(dependencyHeartbeat) }
      if (dependencies.source !== 'present')
        console.log(`Dependencies installed from the ${dependencies.source === 'npm' ? 'npm registry' : 'release runtime pack'}.`)
      console.log('Installing program files and validating this platform...')
      const heartbeat = setInterval(() => console.log('Installation is still running: copying and validating program files...'), 5000)
      let candidate
      try { candidate = await install.stage(source, validateNativeCandidate, input.force) } finally { clearInterval(heartbeat) }
      console.log('Activating Hulala and registering the command...')
      const active = await install.activate(candidate)
      // Another terminal may still be running the version that started this
      // update, so that directory stays until a later update can remove it.
      const running = process.env.HULALA_PACKAGE_ROOT
      const pruned = await install.prune(active, running ? [basename(running)] : [])
      if (pruned.length) console.log('Unrecognized version directories were retained: ' + pruned.join(', '))
      const receipt = await installationReceipt(root).catch(() => undefined)
      // The command is the only Hulala file that belongs on PATH, so it goes into
      // a directory the user already has there. Hulala's own `bin` directory
      // stays private: it holds the bundled nvim and helpers, which must not
      // shadow the user's own commands.
      const onPath = await userPathDirectories(homedir(), process.env, process.platform, [paths.data])
      // A command recorded inside the state root belongs to an older layout; the
      // command now goes into a directory the user already has on PATH.
      const recorded = receipt && !receipt.command.startsWith(resolve(paths.data) + sep) ? dirname(receipt.command) : undefined
      const bin = resolve(input.bin || recorded || onPath[0] || join(homedir(), '.local/bin'))
      await install.installLauncher(join(bin, process.platform === 'win32' ? 'hulala.exe' : 'hulala'))
      // A fresh macOS or Linux account usually has no writable PATH directory
      // (no Homebrew, /usr/local/bin owned by root), so the launcher lands in
      // ~/.local/bin. Leaving that off PATH is exactly how the first run ends in
      // "command not found": register it unless the user opted out, and keep an
      // existing registration instead of writing a second block. An update keeps
      // whatever the installation already recorded.
      let registered = receipt?.pathRegistration ? bin : undefined
      let registeredFiles: string[] | undefined
      const reachable = await onPathAlready(bin)
      if (!reachable && registered === undefined && input.addToPath) {
        try {
          const registration = await addCommandPath(bin, homedir())
          if (registration) {
            await install.rememberPath(registration)
            registered = bin
            if (registration.kind === 'profile') registeredFiles = registration.files
          }
        } catch (error) { console.log(error instanceof Error ? error.message : String(error)) }
      }
      const installed = await installationReceipt(root)
      const removed = await pruneReleaseCache(paths.data, active.current.version).catch(() => [])
      if (removed.length > 0) console.log(`Removed cached release packages: ${removed.join(', ')}`)
      console.log(`Hulala ${active.current.version} ${beforeVersion === active.current.version ? 'is already installed' : command === 'install' ? 'installed' : 'updated'}: ${displayPath(installed.command)}`)
      // The Host started by the previous version keeps serving the plugin set it
      // booted with; this install replaces that code, so it is restarted here.
      const stopped = await stopStaleHost(active.current.version)
      if (stopped !== undefined) console.log(`Stopped the Hulala Host ${stopped}; the next start uses ${active.current.version}.`)
      else if (command === 'install') console.log('Update it later with:  hulala update')
      if (registeredFiles !== undefined) console.log(`Added ${displayPath(bin)} to PATH for new terminals (${registeredFiles.map(displayPath).join(', ')}).`)
      // A freshly registered directory only exists in the next shell, so offer to
      // start it now by absolute path — answering this question is the only step
      // between "installed" and "running". The PATH instructions are printed only
      // when they are needed: after a declined start, or after the client exits in
      // a shell that still cannot see the command.
      const started = command === 'install' && await offerStart(installed.command)
      if (reachable) {
        if (!started) console.log('Start it with:  hulala')
      } else if (registered !== undefined) {
        // A child process cannot change the shell that ran it, so when the
        // directory was just registered this terminal gets the exact line that
        // works right now.
        console.log(started ? 'To run Hulala in this terminal, run:' : 'New terminals can already run it. In this one, run:')
        console.log(`  export PATH=${JSON.stringify(dirname(installed.command))}:"$PATH"`)
        console.log('Then start it with:  hulala')
      } else {
        console.log(`In this terminal, run:  export PATH=${JSON.stringify(dirname(installed.command))}:"$PATH"`)
        console.log(`Start it with:  hulala   (installed at ${JSON.stringify(installed.command)})`)
      }
      return 0
    } finally { await rm(temporary, { recursive: true, force: true }) }
  })
}
