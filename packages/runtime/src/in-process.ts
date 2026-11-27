import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { access, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { loadLayeredEnv, loadOptionalPatches, loadProfile, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { readCreatorMode } from './creator.js'
import {
  ensureRuntimePaths,
  resolveRuntimePaths,
  type RuntimePaths,
  type RuntimeState,
} from './index.js'

const BIN_NAME = 'hulala-runtime'
/** Persistent profile whose patch file holds Settings edits across restarts. */
/** Surface profile name; `hulala plugin` and `hulala install bot` both install here. */
export const PROFILE_NAME = 'tui'
const PROFILE_PATCH_FILE = 'cordis.patch.yml'

/** Options for one in-process DeepSeek Harness Web Host. */
export interface InProcessHarnessOptions {
  repositoryRoot: string
  paths?: Partial<RuntimePaths> & { root?: string }
  version?: string
  /** Bind port for the Host HTTP carrier; zero requests an OS-assigned port. */
  webPort?: number
  environment?: Record<string, string | undefined>
}

/** In-process public Runtime consumed by the compiled private Desktop Host. */
export interface InProcessHarnessHandle {
  readonly ctx: Context
  readonly paths: RuntimePaths
  state(): RuntimeState
  stop(): Promise<void>
}

/**
 * Bundles this Host loads, in `dsh.profile.bundles` order: DSH's own `web`
 * profile template (`@deepseek-ai/dsh-official-bundles`). The Host composition is
 * the upstream one — every product difference is an id-level override in the
 * profile patch, never a re-declared row.
 */
const PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const

/**
 * Bundles this Host adds to that template, in `bundles` order. They are direct
 * runtime dependencies, not profile-local installs: the profile gets a link to
 * the copy the runtime shipped, so an upgrade never leaves an old plugin behind
 * in the profile.
 */
const HOST_BUNDLES = ['@colinagent/dsh-mcp'] as const

/**
 * The whole Hulala composition: four id-level overrides of upstream rows.
 *
 * A patch entry that names an existing row id replaces that row's fields, which
 * is DSH's own mechanism for a composition difference. No row is re-declared, so
 * an upstream change to any other field of these rows still reaches this Host.
 * @param creator - whether the user turned Creator mode on.
 * @returns the patch layers the profile keeps for Hulala itself.
 */
function hulalaRows(creator = false): PatchOptions[] {
  return [
    // DeepSeek's plugin-market inventory and its session-log upload are product
    // and privacy choices, not composition: neither ships in Hulala.
    { id: 'plugin-package-inventory-deepseek', config: { enabled: false } },
    { id: 'session-log-deepseek', config: { enabled: false } },
    // Creator mode is opt-in: the Cordis inspection registry and the providers
    // that describe this process are exactly what the setting grants, so leaving
    // them disabled is what makes the capability absent rather than unused.
    { id: 'cordis-host-runner', disabled: !creator },
    { id: 'cordis-inspect-providers', disabled: !creator },
  ] as PatchOptions[]
}

/**
 * Upstream row ids this composition overrides.
 *
 * A patch row with an `id` and no `insert` overrides an existing Loader row. If
 * upstream renames or drops that row, the Loader warns and **skips** the patch, so
 * the override silently stops happening — the Host then runs the upstream default
 * instead of Hulala's choice. Naming the ids here lets the verifier fail loudly
 * instead.
 */
const OVERRIDDEN_UPSTREAM_ROWS: readonly string[] = [
  'plugin-package-inventory-deepseek',
  'session-log-deepseek',
  'cordis-host-runner',
  'cordis-inspect-providers',
]

/**
 * Assert every row this composition overrides still exists in the bundle it sits on.
 *
 * Reads each bundle's own patch rather than a checked-in list, so a Hulala build
 * cannot go stale against a newer upstream bundle.
 * @param runtimeRequire - a resolver anchored in the checkout.
 * @throws when an overridden id is missing, naming the ids and the bundle.
 */
function verifyOverriddenRows(runtimeRequire: NodeJS.Require): void {
  const present = new Set<string>()
  for (const bundle of PROFILE_BUNDLES) {
    const patchPath = runtimeRequire.resolve(`${bundle}/cordis.patch.yml`)
    for (const line of readFileSync(patchPath, 'utf8').split('\n')) {
      const match = /^\s*-?\s*id:\s*([a-z0-9-]+)\s*$/u.exec(line)
      if (match?.[1] !== undefined) present.add(match[1])
    }
  }
  const missing = OVERRIDDEN_UPSTREAM_ROWS.filter(id => !present.has(id))
  if (missing.length === 0) return
  throw new Error(
    `hulala-runtime: no profile bundle declares ${missing.map(id => `"${id}"`).join(', ')}. `
    + 'These rows override upstream defaults, and a missing row is skipped silently by the Loader. '
    + `Update OVERRIDDEN_UPSTREAM_ROWS in packages/runtime/src/in-process.ts (${PROFILE_BUNDLES.join(', ')}).`,
  )
}

/**
 * Row ids the Host has ever declared, plus the four it still overrides.
 *
 * A profile patch written by an older Host still declares the rows the bundles
 * own today; a duplicated id mounts twice (a second Service instance, a second
 * hook registration), so every one of them is pruned on boot.
 */
const HOST_ROW_IDS = new Set([
  'plugin-package-inventory-deepseek',
  'session-log-deepseek',
  'agent-loop',
  'ptc-runtime',
  'workflow-ptc',
  'tool-workflow',
  'subagent-model-selection-settings',
  'workspace',
  'directory-picker',
  'plugin-inventory',
  'webserver',
  'connection',
  'file-uploads',
  'session-controller',
  'session-stats',
  'job-controller',
  'terminal-controller',
  'workspace-files',
  'schedule',
  'settings-controller',
  'workspace-controller',
  'agent-preset-registry',
  'deliverable-file-references',
  'cordis-host-runner',
  'cordis-inspect-providers',
  'api-remotes',
  'agent-loop-selector',
  'hulala-network',
  'agent-loop-runtime',
  'authorization',
])

/**
 * The row name every agent-preset declaration uses. The rows an agent gets
 * belong to the installed bundle, so the profile never keeps an old copy of
 * them; see {@link ensureProfilePatch}.
 */
const PRESET_ROW_NAME = '@deepseek-ai/dsh-agent-preset'

/** Whether one profile or insert row declares an agent preset. */
function isPresetRow(entry: unknown): boolean {
  return entry !== null && typeof entry === 'object'
    && (entry as { name?: unknown }).name === PRESET_ROW_NAME
}

/**
 * Seed or upgrade the Host profile the way a boot would: the bundle list DSH's
 * `web` template names, plus the id overrides above.
 *
 * On later boots only those rows are replaced. The rows an older Host declared
 * are pruned, and so are agent-preset declarations: presets are composition, not
 * settings, and a profile that keeps its own copy also keeps every row that copy
 * named — an upstream release that retires one (0.2.2 retired
 * `tool-subagent-list-agents`) leaves a profile whose preset cannot start at all.
 * They therefore come from the bundle, never from here. Settings rows are
 * preserved: the profile patch is the Harness settings document, so rewriting it
 * wholesale would discard live edits.
 *
 * `hulala plugin` must run this before handing the profile to DSH's installer:
 * the installer initializes a missing profile from a DSH template, which would
 * seed DSH's composition instead of this Host's bundle list.
 * @param paths - resolved runtime paths.
 * @param runtimeRoot - directory whose package.json anchors the DSH runtime.
 * @returns the profile directory.
 */
export async function seedHostProfile(
  paths: RuntimePaths,
  runtimeRoot: string,
): Promise<string> {
  const profileDir = join(paths.harnessDir, 'profiles', PROFILE_NAME)
  await mkdir(profileDir, { recursive: true, mode: 0o700 })
  const manifestPath = join(profileDir, 'package.json')
  if (!(await exists(manifestPath))) {
    await writeFile(manifestPath, JSON.stringify({
      name: 'hulala-profile',
      private: true,
      dsh: { profile: { bundles: [...PROFILE_BUNDLES] } },
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  }
  await ensureProfilePatch(
    join(profileDir, PROFILE_PATCH_FILE),
    hulalaRows(readCreatorMode(paths.configDir)),
  )
  await detectDshBundles(profileDir, PROFILE_NAME)
  await syncHostBundles(profileDir, runtimeRoot)
  return profileDir
}

/** Manifest shape this file reads and writes; unknown fields are preserved. */
interface ProfileManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
  hulala?: { detected?: string[] }
}

/** Read a profile manifest, or an empty document. */
async function readManifest(path: string): Promise<ProfileManifest> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ProfileManifest
  } catch {
    return {}
  }
}

/** Write a manifest atomically with user-only permissions. */
async function writeManifest(path: string, manifest: ProfileManifest): Promise<void> {
  const temporary = `${path}.${String(process.pid)}.tmp`
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

/**
 * Mirror the bundles a user installed into their own DSH profile.
 *
 * DSH plugins are per-profile, so a plugin the user installed in `~/.dsh` is
 * invisible here. We link the package directory into this profile and record it
 * in `bundles`, which is DSH's own out-of-tree mechanism: the bundle's
 * `@deepseek-ai/dsh-*` imports resolve to the runtime that boots it, and a
 * version the runtime refuses is skipped and reported.
 *
 * Only bundles the user added are taken — the composition this Host ships comes
 * from its own runtime — and the link is removed again when the source
 * disappears. `~/.dsh` is read, never written.
 * @param profileDir - our profile directory.
 * @param profileName - profile name shared with the user's DSH install.
 */
async function detectDshBundles(profileDir: string, profileName: string): Promise<void> {
  const manifestPath = join(profileDir, 'package.json')
  // An install holds this lock while it edits the same manifest. Booting must
  // wait, or the two writes overwrite each other and a plugin silently leaves
  // the bundle list.
  await withFileLock(manifestPath, async () => {
    const userHome = process.env.HULALA_DSH_DETECT_HOME ?? join(homedir(), '.dsh')
    const theirProfile = join(userHome, 'profiles', profileName)
    const theirs = await readManifest(join(theirProfile, 'package.json'))
    const ours = await readManifest(manifestPath)
    const bundles = new Set(ours.dsh?.profile?.bundles ?? [])
    const previous = new Set(ours.hulala?.detected ?? [])
    const dependencies = { ...ours.dependencies }
    const detected = new Set<string>()
    let changed = false

    for (const name of theirs.dsh?.profile?.bundles ?? []) {
      // The bundles this Host composes come from the runtime it ships, never
      // from the user's own DSH install: linking theirs would shadow the pinned
      // version, and a plugin installed against another DSH is exactly what the
      // `engines.dsh` gate would then have to skip.
      if ((PROFILE_BUNDLES as readonly string[]).includes(name) || bundles.has(name)) continue
      const source = join(theirProfile, 'node_modules', name)
      if (!(await exists(join(source, 'package.json')))) continue
      const link = join(profileDir, 'node_modules', name)
      try {
        if (await exists(link)) await rm(link, { recursive: true, force: true })
        await mkdir(dirname(link), { recursive: true })
        await symlink(source, link, 'dir')
      } catch {
        // A link we cannot make is a plugin we do not load; the Host still boots.
        continue
      }
      bundles.add(name)
      dependencies[name] = `link:${source}`
      detected.add(name)
      changed = true
    }

    for (const name of previous) {
      if (detected.has(name)) continue
      await rm(join(profileDir, 'node_modules', name), { recursive: true, force: true }).catch(() => undefined)
      bundles.delete(name)
      delete dependencies[name]
      changed = true
    }

    if (!changed && previous.size === detected.size) return
    const next: ProfileManifest = {
      ...ours,
      dependencies,
      dsh: { ...ours.dsh, profile: { ...ours.dsh?.profile, bundles: [...bundles] } },
      hulala: { ...ours.hulala, detected: [...detected] },
    }
    await writeManifest(manifestPath, next)
  }, { waitMs: 120_000 })
}

/**
 * Link the Host's own bundles into one profile and record them in `bundles`.
 *
 * A row only reaches the Loader when its package resolves from the profile, so
 * the profile needs the link even though the runtime owns the dependency. This
 * mirrors {@link detectDshBundles}: `link:` entries are DSH's out-of-tree
 * mechanism, and a package the runtime does not ship is skipped instead of
 * failing the boot.
 * @param profileDir - the profile directory to update.
 * @param runtimeRoot - directory whose package.json anchors the installed runtime.
 */
async function syncHostBundles(profileDir: string, runtimeRoot: string): Promise<void> {
  const manifestPath = join(profileDir, 'package.json')
  const runtimeRequire = createRequire(pathToFileURL(join(resolve(runtimeRoot), 'package.json')))
  // An install holds this lock while it edits the same manifest (see
  // {@link detectDshBundles}); the two writers must not interleave.
  await withFileLock(manifestPath, async () => {
    const ours = await readManifest(manifestPath)
    const bundles = [...(ours.dsh?.profile?.bundles ?? [])]
    const dependencies = { ...ours.dependencies }
    let changed = false
    // DSH's own template bundles resolve from the installation, not the profile,
    // so naming them is enough: a missing link is exactly the install-scope path.
    for (const name of PROFILE_BUNDLES) {
      if (bundles.includes(name)) continue
      bundles.push(name)
      changed = true
    }
    for (const name of HOST_BUNDLES) {
      const source = packageRootOf(runtimeRequire, name)
      if (source === undefined) continue
      const link = join(profileDir, 'node_modules', name)
      if (!(await relinkBundle(link, source))) continue
      if (!bundles.includes(name)) {
        bundles.push(name)
        changed = true
      }
      const expected = `link:${source}`
      if (dependencies[name] !== expected) {
        dependencies[name] = expected
        changed = true
      }
    }
    if (!changed) return
    await writeManifest(manifestPath, {
      ...ours,
      dependencies,
      dsh: { ...ours.dsh, profile: { ...ours.dsh?.profile, bundles } },
    })
  }, { waitMs: 120_000 })
}

/**
 * Find the package directory a runtime dependency resolves to.
 *
 * `resolve(name)` lands on the entry point, which may sit below the package root,
 * so the nearest enclosing manifest that declares this name wins.
 * @param runtimeRequire - resolver anchored in the runtime root.
 * @param name - package name.
 * @returns the package directory, or `undefined` when it is not installed.
 */
function packageRootOf(runtimeRequire: NodeJS.Require, name: string): string | undefined {
  let directory: string
  try {
    directory = dirname(runtimeRequire.resolve(name))
  } catch {
    return undefined
  }
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: unknown }
      if (manifest.name === name) return directory
    } catch {
      // No manifest at this level: keep walking toward the package root.
    }
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
  return undefined
}

async function ensureProfilePatch(path: string, rows: PatchOptions[]): Promise<void> {
  const existing = loadOptionalPatches(BIN_NAME, path)
  if (existing === undefined || existing.length === 0) {
    await writeFile(path, JSON.stringify(rows, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    return
  }
  let serialized: unknown
  try {
    serialized = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    // DSH's own profile patches are YAML with comments and `!!js` tags. Reuse
    // the parsed layer so a Host can upgrade a profile it did not create.
    serialized = existing
  }
  // Rows this file owns are replaced wholesale, not merged by id: a profile from
  // an older Host version may still name a removed plugin under the same row id,
  // and the bundles own every row this Host no longer declares. Settings rows
  // are preserved.
  serialized = (Array.isArray(serialized) ? serialized : []).flatMap(patch => {
    if (patch === null || typeof patch !== 'object') return [patch]
    const id = (patch as { id?: unknown }).id
    if (typeof id === 'string' && HOST_ROW_IDS.has(id)) return []
    if (isPresetRow(patch)) return []
    const insert = (patch as { insert?: unknown }).insert
    if (!Array.isArray(insert)) return [patch]
    const kept = insert.filter(entry => {
      const rowId = entry === null || typeof entry !== 'object' ? undefined : (entry as { id?: unknown }).id
      if (typeof rowId === 'string' && HOST_ROW_IDS.has(rowId)) return false
      return !isPresetRow(entry)
    })
    return kept.length === 0 ? [] : [{ ...patch, insert: kept }]
  })
  await writeFile(
    path,
    JSON.stringify([...(serialized as unknown[]), ...rows], null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600 },
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Point one profile link at the copy this runtime ships.
 *
 * An upgrade prunes the old runtime version tree, which leaves the profile's
 * symlink dangling: `access` follows the link and reports the path absent while
 * the entry still occupies it, so creating the new link fails with `EEXIST` and
 * the row keeps naming a package that no longer exists. Every boot therefore
 * compares the target, not mere presence, and replaces it — a stale `link:`
 * dependency in the manifest is repaired by the same pass.
 * @param link - profile `node_modules/<name>` entry.
 * @param source - package directory inside this runtime.
 * @returns whether the profile now resolves this bundle from `source`.
 */
async function relinkBundle(link: string, source: string): Promise<boolean> {
  const target = await linkTarget(link)
  // A real directory is an install the user owns; the runtime does not replace
  // it, and DSH's own precedence decides which copy loads.
  if (target === source || target === 'directory') return true
  try {
    if (target !== 'absent') await rm(link, { force: true })
    await mkdir(dirname(link), { recursive: true })
    await symlink(source, link, 'dir')
    return true
  } catch {
    // A link we cannot make is a bundle we do not load; the Host still boots.
    return false
  }
}

/**
 * What occupies a link path: its resolved target, a real directory, or nothing.
 * @param link - path to inspect without following it.
 * @returns absolute symlink target, `'directory'` for a real entry, `'absent'`.
 */
async function linkTarget(link: string): Promise<string | 'directory' | 'absent'> {
  try {
    return resolve(dirname(link), await readlink(link))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return 'absent'
    // `readlink` on a real directory: not a link this function may replace.
    if (code === 'EINVAL' || code === 'EISDIR' || code === 'EPERM') return 'directory'
    throw error
  }
}

function assignedEnvironment(paths: RuntimePaths, version: string): Record<string, string> {
  return {
    HULALA_HOME: paths.root,
    DSH_HOME: paths.harnessDir,
    HULALA_CONFIG_DIR: paths.configDir,
    HULALA_DATA_DIR: paths.dataDir,
    HULALA_WORKSPACE_DIR: paths.workspaceDir,
    HULALA_RUNTIME_DIR: paths.runtimeDir,
    HULALA_LOGS_DIR: paths.logsDir,
    HULALA_CACHE_DIR: paths.cacheDir,
    HULALA_VERSION: version,
  }
}

function installEnvironment(values: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>()
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name])
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

function nestedErrorMessages(error: unknown): string[] {
  const messages: string[] = []
  const seen = new Set<unknown>()
  const visit = (value: unknown): void => {
    if (seen.has(value)) return
    seen.add(value)
    if (value instanceof Error) messages.push(value.message)
    if (value instanceof AggregateError) for (const nested of value.errors) visit(nested)
    if (value instanceof Error && value.cause !== undefined) visit(value.cause)
  }
  visit(error)
  return [...new Set(messages)]
}

/**
 * Boot the public Hulala Runtime in the caller's Cordis process. The profile is
 * DeepSeek Harness's own `web` template plus Hulala's id-level overrides; the
 * caller retains process isolation and owns teardown.
 *
 * Hulala owns only those overrides — the rows written to its `cordis.patch.yml`
 * by {@link seedHostProfile}. Booting the profile is DeepSeek Harness's own
 * `runProfile`: one profile boot resolves the launch environment
 * (including `$DSH_HOME/.env`), gates bundle compatibility, installs the
 * process-wide outbound proxy policy, mounts plugin packages through DSH's
 * runtime interception, wires fail-loud plus bounded shutdown, and commits
 * readiness after the tree settles. None of that belongs to us, and a second
 * implementation is how the Host silently lost all of it.
 */
export async function bootRepositoryHarness(
  options: InProcessHarnessOptions,
): Promise<InProcessHarnessHandle> {
  const paths = resolveRuntimePaths(options.paths)
  await ensureRuntimePaths(paths)
  const version = options.version ?? process.env.HULALA_VERSION ?? '0.1.0'
  // Assign before the launch-environment snapshot is taken: DSH_HOME decides the
  // profile, the home patch layer and the user `.env` layer runProfile reads.
  const restoreEnvironment = installEnvironment({
    ...options.environment,
    ...assignedEnvironment(paths, version),
  })
  let ctx: Context | undefined
  let currentState: RuntimeState = 'starting'
  try {
    const runtimeRequire = createRequire(pathToFileURL(join(resolve(options.repositoryRoot), 'package.json')))
    verifyOverriddenRows(runtimeRequire)
    const installAnchor = runtimeRequire.resolve('@deepseek-ai/dsh/package.json')
    // One bootstrap owns the profile, so a plugin installed before the first
    // boot still lands in this bundle list instead of a DSH template's.
    await seedHostProfile(paths, resolve(options.repositoryRoot))
    const profile = loadProfile(BIN_NAME, PROFILE_NAME, installAnchor, paths.harnessDir)
    reportSkippedBundles(BIN_NAME, profile)
    const booted = await runProfile({
      environment: loadLayeredEnv(BIN_NAME),
      profile: PROFILE_NAME,
      resolvedProfile: { profile, installAnchor },
      patchFiles: [],
      // The Host carrier's bind address is a Web invocation flag, which the
      // bundle's own `web-startup` row parses — no row of ours repeats it.
      args: ['--host', '127.0.0.1', '--port', String(options.webPort ?? 0), '--no-open'],
    })
    ctx = booted.ctx
    currentState = 'running'
    let stopped = false
    return {
      ctx,
      paths,
      state: () => currentState,
      async stop() {
        if (stopped) return
        stopped = true
        currentState = 'stopping'
        // DSH's bounded shutdown owns the tree and the proxy policy; a plugin
        // that will not quiesce is force-exited by it rather than wedging here.
        await booted.shutdown.shutdown(0)
        restoreEnvironment()
        currentState = 'stopped'
      },
    }
  } catch (error) {
    currentState = 'failed'
    await ctx?.fiber.dispose().catch(() => undefined)
    restoreEnvironment()
    const details = nestedErrorMessages(error)
    throw new Error(`in-process Harness boot failed:\n${details.map(message => `- ${message}`).join('\n')}`, { cause: error })
  }
}
