import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionDescriptor, HulalaPaths } from '@hulala/workbench-contracts'
import { resolveHulalaPaths } from '@hulala/workbench-contracts/paths'
import { isAbsolute, resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ensureServerPaths, resolveServerPaths, type ServerConfig } from './config.ts'
import { localPluginsPlugin } from './plugins/localPlugins.ts'
import { desktopTransportPlugin } from './plugins/desktopTransport.ts'
import { productDatabasePlugin } from './plugins/productDatabase.ts'

/** Running private Cordis Host owned by the Desktop main process or SSH launcher. */
export interface DesktopHostHandle {
  readonly descriptor: ConnectionDescriptor
  readonly paths: HulalaPaths
  stop(): Promise<void>
}

interface PublicRuntimeHandle {
  readonly ctx: Context
  stop(): Promise<void>
}

interface PublicRuntimeModule {
  bootRepositoryHarness(options: {
    repositoryRoot: string
    paths: {
      root: string
      configDir: string
      dataDir: string
      workspaceDir: string
      runtimeDir: string
      logsDir: string
      cacheDir: string
    }
    version: string
    environment: Record<string, string | undefined>
    credentialsPath?: string
  }): Promise<PublicRuntimeHandle>
}

async function bootPublicRuntime(config: ServerConfig): Promise<PublicRuntimeHandle> {
  if (config.runtimeHostModule === undefined) throw new Error('runtime host module is required')
  if (config.runtimeRepositoryRoot === undefined) throw new Error('runtime repository root is required')
  if (!isAbsolute(config.runtimeHostModule)) throw new Error('runtime host module must be an absolute path')
  const modulePath = resolve(config.runtimeHostModule)
  process.env.HULALA_RUNTIME_REPOSITORY_ROOT = resolve(config.runtimeRepositoryRoot)
  const imported = await import(pathToFileURL(modulePath).href) as Partial<PublicRuntimeModule>
  if (typeof imported.bootRepositoryHarness !== 'function') {
    throw new Error('runtime host module does not export bootRepositoryHarness')
  }
  const paths = await ensureServerPaths(config)
  return imported.bootRepositoryHarness({
    repositoryRoot: resolve(config.runtimeRepositoryRoot),
    paths: {
      root: paths.root,
      configDir: paths.config,
      dataDir: paths.server,
      workspaceDir: paths.workspace,
      runtimeDir: paths.runtime,
      logsDir: paths.logs,
      cacheDir: paths.cache,
    },
    version: config.version,
    credentialsPath: join(resolveHulalaPaths(config.hulalaRoot, config.workspaceRoot).config, 'harness', '.credentials.yaml'),
    environment: { DSH_TELEMETRY_DISABLED: '1' },
  })
}

function productDatabaseConfig(config: ServerConfig) {
  const paths = resolveServerPaths(config)
  return {
    paths,
    retention: config.retention ?? {
      cronRunDays: 90,
      cronRunMaxPerJob: 200,
      archivedMessageDays: 90,
      archiveRunMaxPerWorkspace: 200,
    },
  }
}

/**
 * Start the private Cordis Host and wait for its authenticated transport.
 * @param config - Desktop Host configuration resolved from process inputs.
 * @returns the ready descriptor plus an idempotent full-context disposer.
 */
export async function createDesktopHost(config: ServerConfig): Promise<DesktopHostHandle> {
  const publicRuntime = await bootPublicRuntime(config)
  try {
    await publicRuntime.ctx.plugin(productDatabasePlugin, productDatabaseConfig(config))
    await publicRuntime.ctx.plugin(localPluginsPlugin, { root: productDatabaseConfig(config).paths.root, workspaceId: config.workspaceId })
    await publicRuntime.ctx.plugin(desktopTransportPlugin, {
      ...config,
      runtimeHostModule: undefined,
      runtimeRepositoryRoot: undefined,
    })
    const transport = publicRuntime.ctx.get('hulalaDesktopTransport')
    if (transport === undefined) throw new Error('Hulala Desktop transport did not become ready')
    return {
      descriptor: transport.descriptor,
      paths: transport.paths,
      stop: () => publicRuntime.stop(),
    }
  } catch (error) {
    await publicRuntime.stop().catch(() => undefined)
    throw error
  }
}
