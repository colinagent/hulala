/**
 * `hulala plugin` — the Host plugin door, and the only one.
 *
 * A plugin is a DSH bundle installed into a profile, exactly as
 * `dsh plugin --profile <name> add <package>` does it. This command therefore
 * does not implement an installer: it seeds the Hulala composition first (so a
 * machine that never started a Host does not get DSH's template profile), then
 * hands the profile to DSH's own `runPluginCommand`, resolved from the runtime
 * that will boot it.
 *
 * Hulala keeps its own DSH home, so what is installed here is invisible to a
 * plain `dsh` install, and vice versa.
 *
 * @module hulala-cli/plugins/host
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRuntimePaths } from '@hulala/runtime'
import { PROFILE_NAME, seedHostProfile } from '@hulala/runtime/host'
import { attachHost, inspectHost, stopHost } from '../hostAttach.ts'

const USAGE = [
  'Usage: hulala plugin --profile <name> add <package>',
  '       hulala plugin --profile <name> remove <package>',
  '       hulala plugin --profile <name> list',
  '',
  'Arguments after --profile are forwarded to the profile\'s package manager,',
  'the same way `dsh plugin --profile <name> ...` forwards them.',
  '',
  '--restart       restart a running Host afterwards and verify it loaded the change',
].join('\n')

/** Result shape returned by DSH's operation runner. */
interface PluginResult {
  readonly exitCode: number
  readonly incompatible?: readonly { readonly name: string; readonly version: string; readonly runtimeVersion: string }[]
}

/**
 * Pull `--profile` out of the forwarded arguments.
 * @param args - command line after `plugin`.
 * @returns the profile name and everything the package manager keeps.
 */
function takeProfile(args: string[]): { profile: string; rest: string[]; restart: boolean } {
  const rest: string[] = []
  let profile: string | undefined
  let restart = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string
    if (argument === '--restart') {
      restart = true
      continue
    }
    if (argument === '--profile') {
      profile = args[index + 1]
      index += 1
      continue
    }
    if (argument.startsWith('--profile=')) {
      profile = argument.slice('--profile='.length)
      continue
    }
    rest.push(argument)
  }
  if (profile === undefined || profile === '') throw new Error(`--profile is required\n\n${USAGE}`)
  if (rest.length === 0) throw new Error(`nothing to forward\n\n${USAGE}`)
  return { profile, rest, restart }
}

/**
 * Directory whose package.json anchors the DSH runtime this Host boots.
 *
 * Three layouts exist: a source checkout (the repository's own node_modules), an
 * installed client (the active version's runtime tree), and an explicit override
 * for tests and remote installs.
 * @param dataRoot - Hulala state root.
 * @param fromUrl - `import.meta.url` of this module.
 * @returns absolute runtime root.
 */
export function resolveRuntimeRoot(dataRoot: string, fromUrl: string): string {
  const override = process.env.HULALA_DSH_RUNTIME_ROOT
  if (override !== undefined) return resolve(override)
  const installed = installedRuntimeRoot(dataRoot)
  if (installed !== undefined) return installed
  try {
    const manifest = createRequire(fromUrl).resolve('@deepseek-ai/dsh/package.json')
    return dirname(dirname(dirname(dirname(manifest))))
  } catch {
    throw new Error('Cannot find the DSH runtime; run `hulala install` or start the Host once.')
  }
}

/**
 * The runtime an installed client boots, recorded by the installer.
 * @param dataRoot - Hulala state root.
 * @returns absolute runtime root, or undefined when this is a source checkout.
 */
function installedRuntimeRoot(dataRoot: string): string | undefined {
  const versions = join(dataRoot, 'runtime', 'client', 'versions')
  // The active version is recorded by the installer; guessing from directory
  // names picks a stale runtime whenever two are installed.
  try {
    const active = JSON.parse(readFileSync(join(dataRoot, 'runtime', 'client', 'active.json'), 'utf8')) as { current?: { id?: string } }
    const id = active.current?.id
    if (typeof id === 'string') {
      const dir = join(versions, id, 'runtime')
      if (existsSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) return dir
    }
  } catch {
    // Fall through to discovery: an unreadable pointer must not block the command.
  }
  if (existsSync(versions)) {
    const candidates = readdirSync(versions)
      .filter(name => existsSync(join(versions, name, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    const newest = candidates.at(-1)
    if (newest !== undefined) return join(versions, newest, 'runtime')
  }
  return undefined
}

/**
 * Run one plugin operation against the Host profile.
 * @param args - command line after `plugin`.
 * @returns process exit code.
 */
export async function runHostPluginCommand(args: string[]): Promise<number> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(USAGE)
    return 0
  }
  const { profile, rest, restart } = takeProfile(args)
  const dataRoot = resolve(process.env.HULALA_HOME ?? join(process.env.HOME ?? '.', '.hulala'))
  const runtimeRoot = resolveRuntimeRoot(dataRoot, import.meta.url)
  const paths = resolveRuntimePaths({ root: dataRoot })
  // Run the package manager with the Host's DSH home, so a plugin's own binary
  // (and its lifecycle scripts) read and write the same state the Host will.
  process.env.DSH_HOME = paths.harnessDir
  const profileDir = await seedHostProfile(paths, runtimeRoot)
  const runtimeRequire = createRequire(pathToFileURL(join(runtimeRoot, 'package.json')))
  const anchor = runtimeRequire.resolve('@deepseek-ai/dsh/package.json')
  const operationsPath = runtimeRequire.resolve('@deepseek-ai/dsh-plugin-manager/operations')
  const { runPluginCommand } = await import(pathToFileURL(operationsPath).href) as {
    runPluginCommand(
      context: { profile: string; dir: string; installAnchor: string; home: string; cwd: string },
      args: readonly string[],
      options: Record<string, unknown>,
    ): Promise<PluginResult>
  }
  const result = await runPluginCommand({
    profile,
    dir: profileDir,
    installAnchor: pathToFileURL(anchor).href,
    home: paths.harnessDir,
    cwd: process.cwd(),
  }, rest, {
    execution: 'cli',
    outputBytes: 16384,
    lockWaitMs: 120000,
    lookupTimeoutMs: 120000,
    onOutput: (text: string, stream: 'stdout' | 'stderr') => { process[stream].write(text) },
  })
  if (result.exitCode === 127) process.stderr.write('hulala: pnpm was not found; install pnpm and make it available on PATH.\n')
  for (const { name, version, runtimeVersion } of result.incompatible ?? []) {
    process.stderr.write(`hulala: ${name}@${version} does not support DSH ${runtimeVersion}; the Host will skip it.\n`)
  }
  if (result.exitCode !== 0) return result.exitCode
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  console.log(`profile ${profile}: ${(manifest.dsh?.profile?.bundles ?? []).join(', ')}`)
  return await verifyActivation(profile, await installedNames(rest, manifest, profileDir), restart)
}

/**
 * Package names an install command names, as the profile now spells them.
 * @param rest - forwarded arguments (`add <spec>...`).
 * @param manifest - profile manifest after the operation.
 * @param profileDir - profile directory, to resolve a path spec.
 * @returns bare package names the operation installed.
 */
async function installedNames(
  rest: readonly string[],
  manifest: { dependencies?: Record<string, string> },
  profileDir: string,
): Promise<string[]> {
  const command = rest.find(argument => !argument.startsWith('-'))
  if (command !== 'add' && command !== 'install' && command !== 'i') return []
  const specs = rest.filter(argument => !argument.startsWith('-') && argument !== command)
  const names = await Promise.all(specs.map(async spec => {
    // A path spec names a directory, not a package: the only honest way to
    // learn which row it installs is to read the manifest it points at.
    if (spec.startsWith('link:') || spec.startsWith('file:')) {
      const target = spec.replace(/^(?:link|file):/u, '')
      const directory = isAbsolute(target) ? target : resolve(profileDir, target)
      try {
        const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: unknown }
        if (typeof pkg.name === 'string') return pkg.name
      } catch {
        // Not a package directory; nothing to verify against.
      }
      return spec
    }
    // `pkg@1` and `@scope/pkg@1` reduce to the manifest key: the version
    // separator is the first `@` after the name itself.
    const version = spec.indexOf('@', spec.startsWith('@') ? 1 : 0)
    return version > 0 ? spec.slice(0, version) : spec
  }))
  const declared = new Set(Object.keys(manifest.dependencies ?? {}))
  return names.filter(name => declared.has(name))
}

/**
 * Report — and with `--restart`, establish — that a running Host loaded a change.
 *
 * Installing writes a profile; a Host imports that profile once, at boot. The
 * two facts differ exactly as long as nobody restarts it, which is invisible
 * without the roster the Host now publishes: a stale process keeps serving the
 * previous version while every file on disk names the new one.
 * @param profile - profile name the operation targeted.
 * @param names - packages the operation installed.
 * @param restart - restart a running Host and verify afterwards.
 * @returns process exit code.
 */
async function verifyActivation(profile: string, names: readonly string[], restart: boolean): Promise<number> {
  const inspected = await inspectHost()
  if (inspected.state !== 'running') {
    console.log(inspected.state === 'stopped'
      ? 'No Host is running; it will load this profile when it starts.'
      : `The Host is ${inspected.state}; restart it before relying on this change.`)
    return 0
  }
  const before = activeVersions(inspected.health.plugins)
  if (restart) {
    await stopHost()
    const health = await attachHost().then(() => inspectHost())
    if (health.state !== 'running') {
      process.stderr.write('hulala: the Host did not come back after the restart.\n')
      return 1
    }
    return report(activeVersions(health.health.plugins), names, 'after the restart', true)
  }
  return report(before, names, `in the running Host (pid ${String(inspected.record.pid)})`, false)
}

/** Module → loaded version, from one Host health document. */
function activeVersions(plugins: readonly { module: string, version: string, state: string }[] | undefined): Map<string, { version: string, state: string }> {
  const map = new Map<string, { version: string, state: string }>()
  for (const row of plugins ?? []) map.set(row.module, { version: row.version, state: row.state })
  return map
}

/**
 * The row a package name refers to.
 *
 * A bundle's Loader row is named by the module it inserts, which may be a
 * subpath export — `@colinagent/hulala-bot` enters as
 * `@colinagent/hulala-bot/plugin`. Comparing the bare package name alone
 * reported a perfectly active bot as "not loaded", so a package owns every row
 * whose module is the name itself or sits below it.
 * @param loaded - module → state from the Host.
 * @param name - package name from the install spec.
 * @returns that package's row, if the Host loaded one.
 */
function rowOf(
  loaded: Map<string, { version: string, state: string }>,
  name: string,
): { version: string, state: string } | undefined {
  const exact = loaded.get(name)
  if (exact !== undefined) return exact
  for (const [module, row] of loaded) {
    if (module.startsWith(`${name}/`)) return row
  }
  return undefined
}

/**
 * Print the difference between a profile and the live roster.
 *
 * An install that succeeded and a Host that has not restarted yet are two
 * different things, and only the second is a failure — of `--restart`, which
 * promises exactly that. Plain `add` therefore reports and exits 0: `hulala
 * install bot` runs it, and a machine that happens to have a Host running must
 * not report a failed install because of a restart it never asked for.
 * @param loaded - module → state from the Host.
 * @param names - packages the operation installed.
 * @param where - how to describe the observed Host.
 * @param required - whether this command promised the change would be live.
 * @returns non-zero only when `required` and a named package is not active.
 */
function report(
  loaded: Map<string, { version: string, state: string }>,
  names: readonly string[],
  where: string,
  required: boolean,
): number {
  if (names.length === 0) return 0
  const missing = names.filter(name => rowOf(loaded, name)?.state !== 'active')
  if (missing.length === 0) {
    console.log(`Loaded ${names.join(', ')} ${where}.`)
    return 0
  }
  // "Not loaded yet" and "loaded and broken" need different advice: restarting
  // fixes only the first, and telling someone to restart a Host that already
  // tried is how a real failure reads as a stale process.
  let stale = false
  for (const name of missing) {
    const row = rowOf(loaded, name)
    if (row === undefined) {
      stale = true
      process.stderr.write(`hulala: ${name} is installed but not loaded ${where}; that Host started before it.\n`)
      continue
    }
    process.stderr.write(`hulala: ${name}@${row.version} is ${row.state} ${where}; the Host log names the reason.\n`)
  }
  if (stale) process.stderr.write('hulala: restart the Host to load it (`hulala host stop && hulala host start`), or pass --restart next time.\n')
  return required ? 1 : 0
}

/** The first-party chat bot, installed like any other Host plugin. */
export const BOT_PACKAGE = '@colinagent/hulala-bot'

/**
 * `hulala install bot` — the one-command shortcut for
 * `hulala plugin --profile <surface> add @colinagent/hulala-bot`.
 *
 * It exists because the bot is ours and every user wants the same profile; the
 * install itself is still DSH's, so there is no second plugin mechanism.
 * @returns process exit code.
 */
export async function installBotCommand(): Promise<number> {
  console.log(`Installing ${BOT_PACKAGE} into profile ${PROFILE_NAME}.`)
  const code = await runHostPluginCommand(['--profile', PROFILE_NAME, 'add', BOT_PACKAGE])
  if (code === 0) {
    console.log(`Now write its config: hulala plugin --profile ${PROFILE_NAME} exec hulala-bot --init`)
  }
  return code
}
