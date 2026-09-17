import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from '@deepseek-ai/dsh-launch-environment'
import {
  createRepositoryHarnessPatch,
  ensureRuntimePaths,
  resolveRuntimePaths,
  type RuntimePaths,
  type RuntimeState,
} from './index'

const BIN_NAME = 'hulala-runtime'
const ROOT_CONFIG = '[]\n'
const PORTABLE_MODULES_KEY = '__HULALA_RUNTIME_MODULES__'

/** Options for one in-process DeepSeek Harness Web Host. */
export interface InProcessHarnessOptions {
  repositoryRoot: string
  paths?: Partial<RuntimePaths> & { root?: string }
  version?: string
  environment?: Record<string, string | undefined>
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

function bundlePatches(
  runtimeRequire: NodeJS.Require,
  packageName: string,
): ReturnType<typeof loadOverlayPatches> {
  const manifestPath = runtimeRequire.resolve(`${packageName}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BundleManifest
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string' || patch.length === 0) {
    throw new Error(`${packageName} does not declare a dsh.bundle patch`)
  }
  return loadOverlayPatches(BIN_NAME, join(dirname(manifestPath), patch))
}

function assignedEnvironment(paths: RuntimePaths, version: string): Record<string, string> {
  return {
    HULALA_HOME: paths.root,
    DSH_HOME: join(paths.configDir, 'harness'),
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
    const base = bundlePatches(runtimeRequire, '@deepseek-ai/dsh-base')
    const hulala = createRepositoryHarnessPatch(options.repositoryRoot)
    const installAnchor = runtimeRequire.resolve('@deepseek-ai/dsh/package.json')
    const host = [
      { id: 'hmr', disabled: true },
      { id: 'plugin-package-inventory-deepseek', config: { enabled: false } },
      { id: 'session-log-deepseek', config: { enabled: false } },
      { insert: [
        { id: 'subagent-model-selection-settings', name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings' },
        { id: 'workspace', name: '@deepseek-ai/dsh-workspace' },
        { id: 'directory-picker', name: '@deepseek-ai/dsh-host-directory-picker-native' },
        { id: 'plugin-inventory', name: '@deepseek-ai/dsh-host-plugin-inventory' },
        { id: 'session-controller', name: '@deepseek-ai/dsh-api-session-controller' },
        { id: 'settings-controller', name: '@deepseek-ai/dsh-api-settings-controller' },
        { id: 'workspace-controller', name: '@deepseek-ai/dsh-api-workspace-controller' },
        {
          id: 'agent-presets',
          name: '@deepseek-ai/dsh-agent-presets',
          config: { default: 'standard' },
        },
      ] },
    ]
    ctx = await boot(
      BIN_NAME,
      rootConfig,
      [...base, ...host, ...hulala],
      (hostCtx) => {
        installPortableModuleResolver(hostCtx, runtimeRequire, installAnchor)
        hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
          { source: 'process', values: inheritedEnvironment() },
        ]))
        provideCmdline(hostCtx, {
          args: [],
          exit: () => undefined,
        })
      },
      pathToFileURL(installAnchor).href,
    )
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
