import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionDescriptor, HulalaPaths } from '@hulala/desktop-contracts'
import { resolveHulalaPaths } from '@hulala/desktop-contracts/paths'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ServerConfig } from './config.ts'
import { hulalaHostPlugin } from './plugins/hulalaHost.ts'

/** Running Hulala Host owned by the Desktop main process or SSH launcher. */
export interface DesktopHostHandle {
  readonly descriptor: ConnectionDescriptor
  readonly paths: HulalaPaths
  stop(): Promise<void>
}

interface PublicRuntimeHandle {
  readonly ctx: Context
  stop(): Promise<void>
}

/**
 * Resolve the DSH engine root without any startup path argument.
 *
 * Packaged Desktop places the Host entry and the engine side by side
 * (`resources/server` and `resources/runtime`); a development checkout resolves
 * to the repository root that contains `packages/runtime`.
 */
function resolveRuntimeRoot(): string {
  const here = import.meta.dirname
  const packaged = resolve(here, '..', 'runtime')
  if (existsSync(join(packaged, 'package.json'))) return packaged
  return resolve(here, '..', '..', '..')
}

async function bootPublicRuntime(config: ServerConfig): Promise<PublicRuntimeHandle> {
  const paths = resolveHulalaPaths(config.hulalaRoot, config.workspaceRoot)
  const { bootRepositoryHarness } = await import('@hulala/runtime/host')
  return bootRepositoryHarness({
    repositoryRoot: resolveRuntimeRoot(),
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
    webPort: config.port,
    environment: { DSH_TELEMETRY_DISABLED: '1' },
  })
}

/**
 * Start the Hulala Host on top of the public Runtime and wait for its
 * authenticated transport.
 * @param config - Host configuration resolved from process inputs.
 * @returns the ready descriptor plus an idempotent full-context disposer.
 */
export async function createDesktopHost(config: ServerConfig): Promise<DesktopHostHandle> {
  const publicRuntime = await bootPublicRuntime(config)
  try {
    await publicRuntime.ctx.plugin(hulalaHostPlugin, config)
    const host = publicRuntime.ctx.get('hulalaHost')
    if (host === undefined) throw new Error('Hulala Host did not become ready')
    return {
      descriptor: host.descriptor,
      paths: host.paths,
      stop: () => publicRuntime.stop(),
    }
  } catch (error) {
    await publicRuntime.stop().catch(() => undefined)
    throw error
  }
}
