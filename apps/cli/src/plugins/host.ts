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
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRuntimePaths } from '@hulala/runtime'
import { seedHostProfile } from '@hulala/runtime/host'

const USAGE = [
  'Usage: hulala plugin --profile <name> add <package>',
  '       hulala plugin --profile <name> remove <package>',
  '       hulala plugin --profile <name> list',
  '',
  'Arguments after --profile are forwarded to the profile\'s package manager,',
  'the same way `dsh plugin --profile <name> ...` forwards them.',
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
function takeProfile(args: string[]): { profile: string; rest: string[] } {
  const rest: string[] = []
  let profile: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string
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
  return { profile, rest }
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
  const { profile, rest } = takeProfile(args)
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
  if (result.exitCode === 0) {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    console.log(`profile ${profile}: ${(manifest.dsh?.profile?.bundles ?? []).join(', ')}`)
    console.log('Restart the Host for the change to take effect.')
  }
  return result.exitCode
}
