/**
 * Install the package's runtime dependencies on the machine that runs it.
 *
 * The release archive carries the Hulala code but not `runtime/node_modules`: the
 * dependency tree is fetched from the release's npm lock (`npm ci`) or, when npm
 * or the registry is unreachable, from the per-target runtime pack the release
 * publishes beside the archive. Both routes end with the same marker inside
 * `runtime/node_modules`, so a staged version directory records how it was
 * installed and a second install never fetches anything.
 *
 * `--ignore-scripts` is the default: a dependency may not run code at install
 * time. Only the three packages Hulala actually needs a build step from are
 * rebuilt afterwards, which is the same allowlist as `trustedDependencies` in
 * `scripts/release/packageRelease.ts`.
 *
 * @module hulala/distribution/dependencies
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, join } from 'node:path'

/** Where the release serves the dependency facts for one target. */
export interface RuntimeAssets {
  /** The `package-lock.json` the installer feeds to `npm ci`. */
  readonly lock: { readonly url: string, readonly sha256: string }
  /** Historical fallback: a pre-installed tree. Hulala no longer publishes one. */
  readonly pack?: { readonly url: string, readonly sha256: string }
}

export interface RuntimeInstallResult {
  /** `present` when the tree was already installed, otherwise how it arrived. */
  readonly source: 'present' | 'npm' | 'pack'
}

/**
 * Runtime packages Hulala does not ship, on any route (npm ci and the pack alike).
 *
 * - `@deepseek-ai/libreoffice-kit-*`: the LibreOffice engine behind
 *   `dsh-office-to-pdf` (140 MB). The adapter loads it lazily on the first
 *   conversion, and the terminal client has no document conversion.
 * - `sherpa-onnx-*` and the experimental speech plugins: pulled in by the
 *   `@deepseek-ai/dsh` meta package, not referenced by the web-app preset the Host
 *   loads, and there is no microphone surface.
 * - the experimental inspector: a development tool.
 * - Windows-only *presets* on non-Windows targets: `dsh-pwsh-sandbox` and the
 *   `dsh-tool-pwsh*` plugins are only referenced by the preset with
 *   `disabled: platform !== 'win32'`.
 *
 * Packages a load-time `import` reaches must stay even when this platform never
 * uses them: `dsh-subprocess-local` imports `dsh-win32-process`,
 * `dsh-sandbox-local` imports `dsh-sandbox-windows-acl`, and a shell plugin
 * imports `dsh-pwsh-local`. Pruning those makes the sandbox and subprocess
 * plugins fail to load, which leaves `tool-bash` waiting for its shell service
 * and the whole agent preset invalid — the Host still reports ready, so only the
 * boot probe's import check catches it.
 *
 * The release's Host boot covers the same tree, so a package that becomes
 * required at load time fails packaging instead of the first install.
 */
const UNSHIPPED: readonly RegExp[] = [
  /^@deepseek-ai\/libreoffice-kit-/,
  /^sherpa-onnx-/,
  /^@deepseek-ai\/dsh-experimental-inspector/,
  /^@deepseek-ai\/dsh-experimental-session-inspector$/,
  /^@deepseek-ai\/dsh-experimental-speech-to-text/,
  /^@deepseek-ai\/dsh-experimental-api-speech-to-text$/,
]
const WINDOWS_ONLY: readonly RegExp[] = [
  /^@deepseek-ai\/dsh-pwsh-sandbox$/,
  /^@deepseek-ai\/dsh-tool-pwsh$/,
  /^@deepseek-ai\/dsh-tool-pwsh-persistent$/,
]

/**
 * Remove the runtime packages (and the other platforms' `node-pty` prebuilds) this
 * target never loads.
 * @param runtime - package `runtime` directory.
 * @param target - `${platform}-${arch}` the tree is for.
 * @param log - progress output.
 * @returns the removed package and prebuild names.
 */
export async function pruneUnshipped(runtime: string, target: string, log: (line: string) => void = () => undefined): Promise<string[]> {
  const modules = join(runtime, 'node_modules')
  const removed: string[] = []
  const skipped = (name: string): boolean => UNSHIPPED.some(pattern => pattern.test(name))
    || (!target.startsWith('win32-') && WINDOWS_ONLY.some(pattern => pattern.test(name)))
  for (const entry of await readdir(modules, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue
    // Unscoped package (`sherpa-onnx-node`) or a scope whose packages are checked
    // one level deeper (`@deepseek-ai/dsh-experimental-inspector`).
    if (!entry.name.startsWith('@')) {
      if (!skipped(entry.name)) continue
      await rm(join(modules, entry.name), { recursive: true, force: true })
      removed.push(entry.name)
      continue
    }
    const scopeDirectory = join(modules, entry.name)
    for (const scoped of await readdir(scopeDirectory, { withFileTypes: true }).catch(() => [])) {
      const name = `${entry.name}/${scoped.name}`
      if (!scoped.isDirectory() || !skipped(name)) continue
      await rm(join(scopeDirectory, scoped.name), { recursive: true, force: true })
      removed.push(name)
    }
  }
  const keep = `${target.startsWith('win32-') ? 'win32' : process.platform}-${target.split('-')[1]}`
  const prebuilds = join(modules, 'node-pty', 'prebuilds')
  for (const entry of await readdir(prebuilds, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.name === keep) continue
    await rm(join(prebuilds, entry.name), { recursive: true, force: true })
    removed.push(`node-pty/prebuilds/${entry.name}`)
  }
  if (removed.length > 0) log(`Removed what this target never loads: ${removed.join(', ')}`)
  return removed
}

/** Packages whose install step Hulala needs (koffi and node-pty build/download). */
const REBUILD = ['koffi', 'node-pty', '@deepseek-ai/dsh-subprocess-local'] as const
const MARKER = '.hulala-runtime.json'

const digest = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

/** Resolve an executable the way a shell would, without a shell. */
async function which(name: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const path = env.PATH ?? ''
  for (const directory of path.split(delimiter)) {
    if (directory === '') continue
    const candidate = join(directory, name)
    // A non-executable npm is still caught by spawn failing; this only finds it.
    const found = await access(candidate).then(() => true, () => false)
    if (found) return candidate
  }
  return undefined
}

/**
 * The desktop proxy this machine uses, when it is not already in the environment.
 *
 * curl and npm only read the environment, while Clash/Surge/V2Ray set the
 * operating system's proxy. Reading it here mirrors `detect_system_proxy` in
 * `installScriptTemplate.ts`, so `hulala update` works on the same machines the
 * installer does.
 */
export async function systemProxy(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy) return undefined
  const run = (command: string, args: string[]): Promise<string> => new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    child.stdout?.on('data', chunk => { output = (output + String(chunk)).slice(0, 64 * 1024) })
    child.once('error', () => resolve(''))
    child.once('exit', () => resolve(output))
  })
  const field = (text: string, name: string): string | undefined => new RegExp(`^\\s*${name}\\s*:\\s*(\\S+)`, 'm').exec(text)?.[1]
  let host: string | undefined, port: string | undefined
  if (process.platform === 'darwin') {
    const report = await run('scutil', ['--proxy'])
    if (field(report, 'ProxyAutoConfigEnable') === '1') return undefined
    if (field(report, 'HTTPSEnable') === '1') { host = field(report, 'HTTPSProxy'); port = field(report, 'HTTPSPort') }
    else if (field(report, 'HTTPEnable') === '1') { host = field(report, 'HTTPProxy'); port = field(report, 'HTTPPort') }
  } else if (process.platform === 'linux') {
    if ((await run('gsettings', ['get', 'org.gnome.system.proxy', 'mode'])).trim() !== "'manual'") return undefined
    host = (await run('gsettings', ['get', 'org.gnome.system.proxy.https', 'host'])).replace(/'/g, '').trim() || undefined
    port = (await run('gsettings', ['get', 'org.gnome.system.proxy.https', 'port'])).trim() || undefined
    if (host === undefined) {
      host = (await run('gsettings', ['get', 'org.gnome.system.proxy.http', 'host'])).replace(/'/g, '').trim() || undefined
      port = (await run('gsettings', ['get', 'org.gnome.system.proxy.http', 'port'])).trim() || undefined
    }
  }
  if (host === undefined || port === undefined || !/^[0-9A-Za-z._-]+$/.test(host) || !/^[0-9]+$/.test(port)) return undefined
  return `http://${host}:${port}`
}

/** Fetch a small release asset and prove it is the one the index pinned. */
async function download(url: string, destination: string, sha256: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000), headers: { accept: 'application/octet-stream' } })
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}): ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (digest(bytes) !== sha256) throw new Error(`SHA-256 mismatch: ${url}`)
  await writeFile(destination, bytes, { mode: 0o600 })
}

interface NpmResult { ok: boolean, output: string }

/** Run npm with the environment the installer would use. */
async function npm(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<NpmResult> {
  return new Promise(resolve => {
    const child = spawn('npm', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let output = ''
    const collect = (chunk: unknown): void => { output = (output + String(chunk)).slice(-16 * 1024) }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.once('error', error => resolve({ ok: false, output: error.message }))
    child.once('exit', code => resolve({ ok: code === 0, output }))
  })
}

/** Patch the packages the release patches, using the `patch` tool every target has. */
async function applyPatches(runtime: string): Promise<void> {
  const directory = join(runtime, 'patches')
  const patches = await readdir(directory).catch(() => [] as string[])
  for (const file of patches.filter(name => name.endsWith('.patch')).sort()) {
    // `@scope%2Fname@1.2.3.patch` names the package the diff applies to.
    const name = basename(file, '.patch')
    const separator = name.lastIndexOf('@')
    if (separator < 1) throw new Error(`Cannot read the package name from the patch ${file}`)
    const packageName = decodeURIComponent(name.slice(0, separator))
    const target = join(runtime, 'node_modules', ...packageName.split('/'))
    // A patch for a package that is not part of the runtime tree (the editor's
    // TUI package is bundled into the client at build time) has already been
    // applied to the code in the archive; nothing to patch here.
    if (!await exists(target)) continue
    await new Promise<void>((resolve, reject) => {
      const child = spawn('patch', ['-p1', '--batch', '--forward', '--silent', '-i', join(directory, file)], { cwd: target, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let output = ''
      child.stdout?.on('data', chunk => { output += String(chunk) })
      child.stderr?.on('data', chunk => { output += String(chunk) })
      child.once('error', error => reject(new Error(`Could not run patch for ${file}: ${error.message}`)))
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Patch ${file} did not apply: ${output.trim()}`)))
    })
  }
}

/**
 * Install `runtime/node_modules` from the package's own lock with npm, then apply
 * the release's patches and rebuild only the allowlisted packages.
 *
 * Packaging and the end-user install run this same function, so the tree on the
 * build machine is the tree users get.
 * @param runtime - directory holding `package.json` and `package-lock.json`.
 * @param options - progress output and environment.
 * @returns the npm output tail on failure, `undefined` on success.
 */
export async function installDependencies(
  runtime: string,
  options: { log?: (line: string) => void, env?: NodeJS.ProcessEnv, registries?: Array<string | undefined>, target?: string } = {},
): Promise<string | undefined> {
  const target = options.target ?? `${process.platform}-${process.arch}`
  const log = options.log ?? (line => console.log(line))
  const environment = { ...process.env, ...options.env }
  if (await which('npm', environment) === undefined) return 'npm is not installed'
  const registries = options.registries ?? [undefined, process.env.HULALA_NPM_REGISTRY, 'https://registry.npmmirror.com']
    .filter((value, index, all): value is string | undefined => value === undefined ? index === 0 : all.indexOf(value) === index)
  for (const registry of registries) {
    log(registry === undefined ? 'Installing dependencies with npm...' : `Retrying with the ${registry} registry...`)
    const args = ['ci', '--ignore-scripts', '--omit=dev', '--include=optional', '--no-audit', '--no-fund']
    if (registry !== undefined) args.push(`--registry=${registry}`)
    const result = await npm(args, runtime, environment)
    if (!result.ok) { log(result.output.trim()); continue }
    const rebuild = await npm(['rebuild', '--no-audit', '--no-fund', ...REBUILD], runtime, environment)
    if (!rebuild.ok) log(`warning: rebuilding native dependencies failed: ${rebuild.output.trim()}`)
    await applyPatches(runtime)
    await pruneInstalledTree(runtime)
    await pruneUnshipped(runtime, target, log)
    return undefined
  }
  return 'npm could not install the dependencies'
}

/**
 * Trim what a published package carries but nothing reads at runtime: type
 * declarations, markdown, `.bin` links and other symlinks. Licences and notices
 * stay, and the package format forbids symlinks anyway.
 */
async function pruneInstalledTree(runtime: string): Promise<void> {
  const keepMarkdown = /^(?:license|licence|copying|notice|third[-_]?party)/i
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) { await rm(path, { force: true }); continue }
      if (entry.isDirectory()) {
        if (entry.name === '.bin') { await rm(path, { recursive: true, force: true }); continue }
        await walk(path)
        continue
      }
      if (entry.name.endsWith('.d.ts')) { await rm(path, { force: true }); continue }
      if (entry.name.endsWith('.md') && !keepMarkdown.test(entry.name)) await rm(path, { force: true })
    }
  }
  await walk(join(runtime, 'node_modules')).catch(() => undefined)
}

async function writeMarker(runtime: string, value: Record<string, unknown>): Promise<void> {
  const marker = join(runtime, 'node_modules', MARKER)
  await writeFile(marker, `${JSON.stringify({ format: 1, installedAt: new Date().toISOString(), ...value }, null, 2)}\n`, { mode: 0o600 })
}

/**
 * Make `runtime/node_modules` exist, using npm first and the runtime pack second.
 * @param runtime - the package's `runtime` directory inside a staged version.
 * @param assets - release-provided lock and pack, or `undefined` for a package that carries its own tree.
 * @param options - progress output and environment injection.
 * @returns how the tree arrived.
 */
export async function ensureRuntimeDependencies(
  runtime: string,
  assets: RuntimeAssets | undefined,
  options: { log?: (line: string) => void, env?: NodeJS.ProcessEnv } = {},
): Promise<RuntimeInstallResult> {
  const log = options.log ?? (line => console.log(line))
  const environment: NodeJS.ProcessEnv = { ...process.env, ...options.env }
  const modules = join(runtime, 'node_modules')
  if (await exists(join(modules, MARKER))) return { source: 'present' }
  let declared: { dependencies?: Record<string, string> } | undefined
  try { declared = JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> } }
  catch { declared = undefined }
  if (declared === undefined || Object.keys(declared.dependencies ?? {}).length === 0) return { source: 'present' }
  if (assets === undefined) throw new Error('This package publishes no dependency lock; reinstall Hulala from the release installer')
  const proxy = await systemProxy(environment)
  if (proxy !== undefined) {
    for (const key of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'npm_config_proxy', 'npm_config_https_proxy']) environment[key] = proxy
    log(`Using the system proxy ${proxy}`)
  }
  const work = await mkdtemp(join(tmpdir(), 'hulala runtime '))
  try {
    const lock = join(work, 'package-lock.json')
    await download(assets.lock.url, lock, assets.lock.sha256)
    await rm(modules, { recursive: true, force: true })
    await writeFile(join(runtime, 'package-lock.json'), await readFile(lock), { mode: 0o600 })
    const failure = await installDependencies(runtime, { log, env: environment })
    if (failure === undefined) {
      await writeMarker(runtime, { source: 'npm', lockSha256: assets.lock.sha256 })
      return { source: 'npm' }
    }
    if (assets.pack === undefined) throw new Error(`Hulala could not install its dependencies with npm (${failure}). Install Node.js 24.9+ with npm and run the install command again.`)
    log(`${failure}; using the release runtime pack instead.`)
    const archive = join(work, 'runtime.tar.gz')
    await download(assets.pack.url, archive, assets.pack.sha256)
    const listing = await new Promise<string>((resolve, reject) => {
      const child = spawn('tar', ['-tzf', archive], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let output = ''
      child.stdout?.on('data', chunk => { output += String(chunk) })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve(output) : reject(new Error('The runtime pack is not a readable archive')))
    })
    if (listing.split('\n').some(line => line.startsWith('/') || line.split('/').includes('..')))
      throw new Error('The runtime pack contains an unsafe path')
    await rm(modules, { recursive: true, force: true })
    const extracted = await new Promise<boolean>(resolve => {
      const child = spawn('tar', ['-xzf', archive, '-C', runtime], { stdio: 'inherit', windowsHide: true })
      child.once('error', () => resolve(false))
      child.once('exit', code => resolve(code === 0))
    })
    if (!extracted) throw new Error('The runtime pack could not be unpacked')
    // A pack from an older release may still carry what this release trims.
    await pruneUnshipped(runtime, `${process.platform}-${process.arch}`, log)
    await writeMarker(runtime, { source: 'pack', packSha256: assets.pack.sha256 })
    return { source: 'pack' }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
