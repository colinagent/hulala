import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot, loadOptionalPatches, loadOverlayPatches, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from '@deepseek-ai/dsh-launch-environment'
import { readCreatorMode } from './creator.js'
import {
  createNativeHarnessPatch,
  ensureRuntimePaths,
  resolveRuntimePaths,
  type RuntimePaths,
  type RuntimeState,
} from './index.js'

const BIN_NAME = 'hulala-runtime'
const ROOT_CONFIG = '[]\n'
/** Persistent profile whose patch file holds Settings edits across restarts. */
const PROFILE_NAME = 'tui'
const PROFILE_PATCH_FILE = 'cordis.patch.yml'
const PORTABLE_MODULES_KEY = '__HULALA_RUNTIME_MODULES__'

/** Options for one in-process DeepSeek Harness Web Host. */
export interface InProcessHarnessOptions {
  repositoryRoot: string
  paths?: Partial<RuntimePaths> & { root?: string }
  version?: string
  /** Bind port for the Host HTTP carrier; zero requests an OS-assigned port. */
  webPort?: number
  environment?: Record<string, string | undefined>
  /** A shared native credential document; settings and sessions can remain isolated. */
  credentialsPath?: string
}

/** In-process public Runtime consumed by the compiled private Desktop Host. */
export interface InProcessHarnessHandle {
  readonly ctx: Context
  readonly paths: RuntimePaths
  state(): RuntimeState
  stop(): Promise<void>
}

interface BundleManifest {
  dsh?: { bundle?: { patch?: unknown } }
}

const PRESET_BUNDLE = '@deepseek-ai/dsh-web-app'
/**
 * Agent presets Hulala offers. The upstream `ptc` preset needs the Node PTC runtime
 * Bun cannot load, and `cordis` needs the Web composition's Cordis inspection rows.
 */
const PRESET_LAYERS = ['standard.patch.yml', 'minimal.patch.yml']

/** Hulala host rows added over the upstream bundle: shared services and API surfaces. */
function hostRows(webPort = 0, creator = false): PatchOptions[] {
  return [
    // Harness 0.2.1 serializes profile patch writes through the HMR service.
    { id: 'plugin-package-inventory-deepseek', config: { enabled: false } },
    { id: 'session-log-deepseek', config: { enabled: false } },
    { insert: [
      { id: 'workspace', name: '@deepseek-ai/dsh-workspace' },
      { id: 'webserver', name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: webPort } },
      { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
      { id: 'file-uploads', name: '@deepseek-ai/dsh-client-file-upload' },
      { id: 'session-controller', name: '@deepseek-ai/dsh-api-session-controller' },
      // Provider credentials and LLM settings: the terminal client's `/login`
      // writes a stored API key and the profile that references it.
      { id: 'settings-controller', name: '@deepseek-ai/dsh-api-settings-controller' },
      { id: 'workspace-controller', name: '@deepseek-ai/dsh-api-workspace-controller' },
      { id: 'agent-preset-registry', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'standard' } },
      // Creator mode's Host half, and only when the user asked for it: the
      // read-only registry of this process's own Cordis surface plus the
      // providers that describe it. Leaving both rows out is what makes the
      // capability absent rather than merely unused.
      ...(creator
        ? [
            { id: 'cordis-host-runner', name: '@deepseek-ai/dsh-cordis-host-runner' },
            { id: 'cordis-inspect-providers', name: '@deepseek-ai/dsh-tool-cordis/host' },
          ]
        : []),
    ] },
  ] as PatchOptions[]
}

/**
 * Upstream row ids this composition targets.
 *
 * A patch row with an `id` and no `insert` overrides an existing Loader row. If
 * upstream renames or drops that row, the Loader warns and **skips** the patch, so
 * the override silently stops happening — the Host then runs the upstream default
 * instead of Hulala's choice. Naming the ids here lets the verifier fail loudly
 * instead.
 */
const OVERRIDDEN_UPSTREAM_ROWS: readonly string[] = [
  'agent-loop',
  'ptc-runtime',
  'workflow-ptc',
  'tool-workflow',
  'plugin-package-inventory-deepseek',
  'session-log-deepseek',
]

/**
 * Assert every row this composition overrides still exists in the bundle it sits on.
 *
 * Reads the bundle's own patch rather than a checked-in list, so a Hulala build
 * cannot go stale against a newer upstream bundle.
 * @param runtimeRequire - a resolver anchored in the checkout.
 * @throws when an overridden id is missing, naming the ids and the bundle.
 */
function verifyOverriddenRows(runtimeRequire: NodeJS.Require): void {
  const patchPath = runtimeRequire.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')
  const present = new Set(
    readFileSync(patchPath, 'utf8').split('\n').flatMap((line) => {
      const match = /^\s*-?\s*id:\s*([a-z0-9-]+)\s*$/u.exec(line)
      return match?.[1] === undefined ? [] : [match[1]]
    }),
  )
  const missing = OVERRIDDEN_UPSTREAM_ROWS.filter(id => !present.has(id))
  if (missing.length === 0) return
  throw new Error(
    `hulala-runtime: @deepseek-ai/dsh-base no longer declares ${missing.map(id => `"${id}"`).join(', ')}. `
    + 'These rows override upstream defaults, and a missing row is skipped silently by the Loader. '
    + `Update OVERRIDDEN_UPSTREAM_ROWS in packages/runtime/src/in-process.ts (${patchPath}).`,
  )
}

/** Rows owned by the Host composition; removing one from `hostRows()` prunes it from old profiles. */
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
  'job-controller',
  'terminal-controller',
  'workspace-files',
  'schedule',
  'settings-controller',
  'workspace-controller',
  'agent-preset-registry',
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
 * Seed the profile patch with Hulala's composition the first time it is used.
 * On later boots, replace only Host-owned rows and the agent-preset
 * declarations, and append the current composition; settings rows are
 * preserved. The profile patch is the Harness settings document, so rewriting
 * it wholesale would discard live edits.
 *
 * Presets are composition, not settings: the rows an agent gets belong to the
 * installed bundle. A profile that keeps its own copy also keeps every row that
 * copy named, so an upstream release that retires one (0.2.2 retired
 * `tool-subagent-list-agents`) leaves a profile whose preset cannot start at
 * all. The declarations are therefore re-read from the bundle on every boot.
 */
async function readBundles(manifestPath: string): Promise<string[] | undefined> {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { dsh?: { profile?: { bundles?: unknown } } }
    const bundles = manifest.dsh?.profile?.bundles
    return Array.isArray(bundles) && bundles.length > 0 && bundles.every(name => typeof name === 'string')
      ? bundles
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Create or upgrade the Host profile the way a boot would.
 *
 * `hulala plugin` must run this before handing the profile to DSH's installer:
 * the installer initializes a missing profile from DSH's template, which would
 * seed DSH's composition instead of Hulala's.
 * @param paths - resolved runtime paths.
 * @param runtimeRoot - directory whose package.json anchors the DSH runtime.
 * @param options - Host options that shape the composition.
 * @returns the profile directory.
 */
export async function seedHostProfile(
  paths: RuntimePaths,
  runtimeRoot: string,
  options: { webPort?: number } = {},
): Promise<string> {
  const profileDir = join(paths.harnessDir, 'profiles', PROFILE_NAME)
  await mkdir(profileDir, { recursive: true, mode: 0o700 })
  const manifestPath = join(profileDir, 'package.json')
  if (!(await exists(manifestPath))) {
    await writeFile(manifestPath, JSON.stringify({
      name: 'hulala-profile',
      private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  }
  const runtimeRequire = createRequire(pathToFileURL(join(resolve(runtimeRoot), 'package.json')))
  const creator = readCreatorMode(paths.configDir)
  await ensureProfilePatch(
    join(profileDir, PROFILE_PATCH_FILE),
    [...presetPatches(runtimeRequire), ...hostRows(options.webPort, creator), ...createNativeHarnessPatch()],
    creator,
  )
  return profileDir
}

async function ensureProfilePatch(path: string, rows: PatchOptions[], creator = false): Promise<void> {
  const existing = loadOptionalPatches(BIN_NAME, path)
  if (existing === undefined || existing.length === 0) {
    await writeFile(path, JSON.stringify(withCreatorTools(
      rows.map(row => ('insert' in row ? row : { id: (row as { id?: string }).id, ...row })),
      creator,
    ), null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
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
  // Host-owned rows and preset declarations are replaced wholesale, not merged
  // by id: a profile from an older Host version may still name a removed plugin
  // under the same row id. Settings rows are preserved.
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
  const managed: PatchOptions[] = []
  for (const row of rows) {
    if ('insert' in row && Array.isArray(row.insert)) {
      const additions = row.insert.filter(entry => {
        const id = entry === null || typeof entry !== 'object' ? undefined : (entry as { id?: unknown }).id
        return (typeof id === 'string' && HOST_ROW_IDS.has(id)) || isPresetRow(entry)
      })
      if (additions.length > 0) managed.push({ ...row, insert: additions } as PatchOptions)
      continue
    }
    const id = (row as { id?: unknown }).id
    if ((typeof id === 'string' && HOST_ROW_IDS.has(id)) || isPresetRow(row)) managed.push(row)
  }
  if (managed.length === 0) return
  await writeFile(path, JSON.stringify(withCreatorTools([...(serialized as unknown[]), ...managed], creator), null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
}

function bundlePatchFiles(
  runtimeRequire: NodeJS.Require,
  packageName: string,
): string[] {
  const manifestPath = runtimeRequire.resolve(`${packageName}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BundleManifest
  const patch = manifest.dsh?.bundle?.patch
  const layers = Array.isArray(patch) ? patch : [patch]
  if (layers.length === 0 || layers.some(layer => typeof layer !== 'string' || layer.length === 0)) {
    throw new Error(`${packageName} does not declare a dsh.bundle patch`)
  }
  return (layers as string[]).map(layer => join(dirname(manifestPath), layer))
}

function bundlePatches(
  runtimeRequire: NodeJS.Require,
  packageName: string,
): ReturnType<typeof loadOverlayPatches> {
  return bundlePatchFiles(runtimeRequire, packageName).flatMap(file => loadOverlayPatches(BIN_NAME, file))
}

/** Preset plugins this process cannot activate; declared presets keep them, disabled. */
const UNAVAILABLE_PRESET_MODULES = new Set([
  '@deepseek-ai/dsh-workflow-ptc',
  '@deepseek-ai/dsh-tool-workflow',
])

/**
 * Harness 0.2.1 enables per-Agent model-selection settings through
 * `tool-subagent` config; that scoped path reads `ctx.subagents` from the Agent
 * scope, which Hulala's base-only composition does not expose. Hulala owns the
 * model picker itself, so the preset flag is dropped rather than the tool.
 */
function withoutScopedModelSelection(row: Record<string, unknown>): Record<string, unknown> {
  const config = row.config
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return row
  const settings = config as { modelSelectionSettings?: unknown }
  if (settings.modelSelectionSettings !== true) return row
  const { modelSelectionSettings: _dropped, ...rest } = settings
  return { ...row, config: rest }
}

/** Disable, rather than drop, preset plugins this process cannot load; groups nest arrays. */
function preparePresetRows(entries: unknown[]): unknown[] {
  const prepared: unknown[] = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') {
      prepared.push(entry)
      continue
    }
    const row = entry as Record<string, unknown> & { name?: unknown; config?: unknown }
    if (typeof row.name === 'string' && UNAVAILABLE_PRESET_MODULES.has(row.name)) continue
    const config = row.config
    if (Array.isArray(config)) {
      prepared.push(withoutScopedModelSelection({ ...row, config: preparePresetRows(config) }))
      continue
    }
    if (config !== null && typeof config === 'object' && Array.isArray((config as { plugins?: unknown }).plugins)) {
      const plugins = preparePresetRows((config as { plugins: unknown[] }).plugins)
      prepared.push(withoutScopedModelSelection({ ...row, config: { ...config, plugins } }))
      continue
    }
    prepared.push(withoutScopedModelSelection(row))
  }
  return prepared
}

/** The preset row Creator mode contributes to every agent composition. */
const CREATOR_PRESET_ROW: Readonly<Record<string, unknown>> = {
  id: 'tool-cordis',
  name: '@deepseek-ai/dsh-tool-cordis',
}

/** The id of {@link CREATOR_PRESET_ROW}, for removing it again. */
const CREATOR_PRESET_ROW_ID = String(CREATOR_PRESET_ROW.id)

/**
 * Add or remove the Creator-mode tool row in every agent-preset declaration.
 *
 * It has to work in both directions: the profile patch keeps preset rows across
 * boots, so turning the setting off must strip the row from a profile that
 * already has it, or the agent would keep a capability the user switched off.
 *
 * Only rows that *are* a preset are touched. A nested group's plugin list is not
 * the place for a tool the whole agent should see.
 * @param entries - preset-layer or profile-patch rows.
 * @param creator - whether Creator mode is on.
 * @returns the rows with the tool row added or removed.
 */
function withCreatorTools(entries: unknown[], creator: boolean): unknown[] {
  return entries.map((entry) => {
    if (entry === null || typeof entry !== 'object') return entry
    const row = entry as Record<string, unknown> & { name?: unknown; config?: unknown }
    if (row.name !== '@deepseek-ai/dsh-agent-preset') return entry
    const config = row.config
    if (config === null || typeof config !== 'object') return entry
    const plugins = (config as { plugins?: unknown }).plugins
    if (!Array.isArray(plugins)) return entry
    const present = plugins.some(plugin => plugin !== null
      && typeof plugin === 'object'
      && (plugin as { id?: unknown }).id === CREATOR_PRESET_ROW_ID)
    if (creator === present) return entry
    const next = creator
      ? [...plugins, CREATOR_PRESET_ROW]
      : plugins.filter(plugin => !(plugin !== null
        && typeof plugin === 'object'
        && (plugin as { id?: unknown }).id === CREATOR_PRESET_ROW_ID))
    return { ...row, config: { ...config, plugins: next } }
  })
}

/** Load the Agent preset declarations the Web bundle ships, without its browser UI rows. */
function presetPatches(
  runtimeRequire: NodeJS.Require,
): ReturnType<typeof loadOverlayPatches> {
  const presetRoot = join(dirname(runtimeRequire.resolve(`${PRESET_BUNDLE}/package.json`)), 'presets')
  const layers = PRESET_LAYERS.flatMap(layer => loadOverlayPatches(BIN_NAME, join(presetRoot, layer)))
  return layers.map(patch => {
    const insert = (patch as { insert?: unknown }).insert
    if (!Array.isArray(insert)) return patch
    return { ...patch, insert: preparePresetRows(insert) } as PatchOptions
  })
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
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

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).flatMap(([name, value]) => value === undefined ? [] : [[name, value]]),
  )
}

function installPortableModuleResolver(
  ctx: Context,
  runtimeRequire: NodeJS.Require,
  installAnchor: string,
): void {
  const loader = ctx.get('loader') as {
    internal?: {
      import(specifier: string, baseUrl?: string): Promise<unknown>
    }
  } | undefined
  if (loader === undefined) throw new Error('Harness Loader is unavailable during Host preparation')
  loader.internal = {
    async import(specifier, baseUrl) {
      const portableModules = (globalThis as Record<string, unknown>)[PORTABLE_MODULES_KEY] as
        | ReadonlyMap<string, unknown>
        | undefined
      const portableKey = (() => {
        if (!specifier.startsWith('file:')) return specifier
        const match = /\/packages\/([^/]+)\/lib\/index\.js$/u.exec(new URL(specifier).pathname)
        return match === null ? specifier : `@hulala-local/${match[1]}`
      })()
      if (portableModules?.has(portableKey)) return portableModules.get(portableKey)
      if (specifier.startsWith('file:')) return import(specifier)
      if (specifier.startsWith('.')) {
        if (baseUrl === undefined) throw new Error(`relative plugin ${specifier} has no base URL`)
        return import(new URL(specifier, baseUrl).href)
      }
      const resolved = runtimeRequire.resolve(specifier)
      return import(pathToFileURL(resolved).href)
    },
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
 * Boot the public Hulala Runtime in the caller's Cordis process. The profile
 * uses DeepSeek Harness's shipped base/web bundle patches and public Hulala
 * plugin overlay; the caller retains process isolation and owns teardown.
 */
export async function bootRepositoryHarness(
  options: InProcessHarnessOptions,
): Promise<InProcessHarnessHandle> {
  const paths = resolveRuntimePaths(options.paths)
  await ensureRuntimePaths(paths)
  const temporaryRoot = await mkdtemp(join(paths.runtimeDir, 'in-process-profile-'))
  await symlink(join(resolve(options.repositoryRoot), 'node_modules'), join(temporaryRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const rootConfig = join(temporaryRoot, 'cordis.yml')
  await writeFile(rootConfig, ROOT_CONFIG, { encoding: 'utf8', mode: 0o600 })
  const version = options.version ?? process.env.HULALA_VERSION ?? '0.1.0'
  const restoreEnvironment = installEnvironment({
    ...options.environment,
    ...assignedEnvironment(paths, version),
  })
  let ctx: Context | undefined
  let currentState: RuntimeState = 'starting'
  try {
    const runtimeRequire = createRequire(pathToFileURL(join(resolve(options.repositoryRoot), 'package.json')))
    verifyOverriddenRows(runtimeRequire)
    const presetLayers = presetPatches(runtimeRequire)
    const hulalaPatch = createNativeHarnessPatch()
    const installAnchor = runtimeRequire.resolve('@deepseek-ai/dsh/package.json')
    // Harness 0.2.1 keeps live settings in the profile patch and reconciles the
    // whole profile on every edit, so the composition itself must live there.
    const dshHome = paths.harnessDir
    const profileDir = join(dshHome, 'profiles', PROFILE_NAME)
    await mkdir(profileDir, { recursive: true, mode: 0o700 })
    const profileManifestPath = join(profileDir, 'package.json')
    if (!(await exists(profileManifestPath))) {
      await writeFile(profileManifestPath, JSON.stringify({
        name: 'hulala-profile',
        private: true,
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
      }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    }
    const profilePatchPath = join(profileDir, PROFILE_PATCH_FILE)
    const creator = readCreatorMode(paths.configDir)
    await ensureProfilePatch(profilePatchPath, [...presetLayers, ...hostRows(options.webPort, creator), ...hulalaPatch], creator)
    const profileContext: ProfileContext = {
      name: PROFILE_NAME,
      dir: profileDir,
      patchPath: profilePatchPath,
      installAnchor: pathToFileURL(installAnchor).href,
      startedBundles: (await readBundles(profileManifestPath)) ?? ['@deepseek-ai/dsh-base'],
      cwd: process.cwd(),
      home: dshHome,
      overlays: [],
      telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
    }
    // Harness HMR waits for the launcher to commit successful startup.
    const readyListeners = new Set<() => void>()
    let readyCommitted = false
    const appReady: AppReady = {
      onReady(listener) {
        if (readyCommitted) { listener(); return () => undefined }
        readyListeners.add(listener)
        return () => { readyListeners.delete(listener) }
      },
    }
    const commitReady = (): void => {
      if (readyCommitted) return
      readyCommitted = true
      for (const listener of readyListeners) listener()
      readyListeners.clear()
    }
    const overlays: PatchOptions[] = options.credentialsPath
      ? [{ id: 'credentials', config: { path: resolve(options.credentialsPath) } }]
      : []
    ctx = await boot(
      BIN_NAME,
      rootConfig,
      readProfilePatches(BIN_NAME, { ...profileContext, overlays }),
      (hostCtx) => {
        installPortableModuleResolver(hostCtx, runtimeRequire, installAnchor)
        hostCtx.provide('profileContext', profileContext)
        hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
          { source: 'process', values: inheritedEnvironment() },
        ]))
        provideCmdline(hostCtx, {
          args: [],
          exit: () => undefined,
          ready: appReady,
        })
      },
      pathToFileURL(installAnchor).href,
    )
    // Readiness starts rows that defer work until startup is committed (HMR watchers,
    // Gateway readiness). Give them one settle window before reporting running.
    commitReady()
    await new Promise<void>(resolve => { setTimeout(resolve, 150) })
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
        await ctx!.fiber.dispose()
        await rm(temporaryRoot, { recursive: true, force: true })
        restoreEnvironment()
        currentState = 'stopped'
      },
    }
  } catch (error) {
    currentState = 'failed'
    await ctx?.fiber.dispose().catch(() => undefined)
    await rm(temporaryRoot, { recursive: true, force: true })
    restoreEnvironment()
    const details = nestedErrorMessages(error)
    throw new Error(`in-process Harness boot failed:\n${details.map(message => `- ${message}`).join('\n')}`, { cause: error })
  }
}
