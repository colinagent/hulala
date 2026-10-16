import { chmod, mkdir, rename, writeFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { HulalaPaths } from '@hulala/workbench-contracts'
import { resolveHulalaPaths } from '@hulala/workbench-contracts/paths'
import { HULALA_VERSION } from '@hulala/workbench-contracts/version'

export interface ServerConfig {
  host: '127.0.0.1'
  port: number
  hulalaRoot?: string
  workspaceRoot?: string
  runtimeHostModule?: string
  runtimeRepositoryRoot?: string
  version: string
  workspaceId?: string
  workspacePath?: string
  retention?: {
    cronRunDays: number
    cronRunMaxPerJob: number
    archivedMessageDays: number
    archiveRunMaxPerWorkspace: number
  }
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

export function parseServerConfig(argv = process.argv.slice(2)): ServerConfig {
  const option = (name: string): string | undefined => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const portValue = option('--port') ?? process.env.HULALA_SERVER_PORT ?? '0'
  const port = Number(portValue)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`invalid port: ${portValue}`)
  const runtimeHostModule = option('--runtime-host-module') ?? process.env.HULALA_RUNTIME_HOST_MODULE
  const runtimeRepositoryRoot = option('--runtime-repository-root') ?? process.env.HULALA_RUNTIME_REPOSITORY_ROOT
  if (runtimeHostModule && !runtimeRepositoryRoot) throw new Error('runtime repository root is required with a runtime host module')
  return {
    host: '127.0.0.1',
    port,
    hulalaRoot: option('--hulala-home') ?? process.env.HULALA_HOME,
    workspaceRoot: option('--workspace-root') ?? process.env.HULALA_WORKSPACE_ROOT,
    runtimeHostModule,
    runtimeRepositoryRoot,
    version: process.env.HULALA_VERSION ?? HULALA_VERSION,
    workspaceId: process.env.HULALA_BROWSER_WORKSPACE_ID,
    workspacePath: process.env.HULALA_BROWSER_WORKSPACE_PATH,
    retention: {
      cronRunDays: positiveInteger(option('--cron-run-days') ?? process.env.HULALA_CRON_RUN_DAYS, 90, 'cron run days'),
      cronRunMaxPerJob: positiveInteger(option('--cron-run-max') ?? process.env.HULALA_CRON_RUN_MAX, 200, 'cron run max'),
      archivedMessageDays: positiveInteger(option('--archived-message-days') ?? process.env.HULALA_ARCHIVED_MESSAGE_DAYS, 90, 'archived message days'),
      archiveRunMaxPerWorkspace: positiveInteger(option('--archive-run-max') ?? process.env.HULALA_ARCHIVE_RUN_MAX, 200, 'archive run max'),
    },
  }
}

export function resolveServerPaths(config: ServerConfig): HulalaPaths {
  const paths = resolveHulalaPaths(config.hulalaRoot, config.workspaceRoot)
  if (!config.workspaceId) return paths
  if (!/^[a-f0-9-]{36}$/.test(config.workspaceId) || !config.workspacePath) throw new Error('Invalid Workspace isolation configuration')
  for (const key of ['config', 'server', 'runtime', 'logs', 'cache', 'transfers'] as const) {
    paths[key] = join(paths[key], 'workspaces', config.workspaceId)
  }
  paths.workspace = resolve(config.workspacePath)
  return paths
}

export async function ensureServerPaths(config: ServerConfig): Promise<HulalaPaths> {
  if (!config.workspaceId) return ensureHulalaPaths(config.hulalaRoot, config.workspaceRoot)
  const paths = resolveServerPaths(config)
  if (!(await stat(paths.workspace)).isDirectory()) throw new Error('Workspace directory is unavailable')
  await Promise.all(['config', 'desktop', 'server', 'runtime', 'logs', 'cache', 'transfers'].map(async key => {
    const path = paths[key as keyof HulalaPaths]
    await mkdir(path, { recursive: true, mode: 0o700 })
  }))
  return paths
}

export async function ensureHulalaPaths(root?: string, workspaceRoot?: string): Promise<HulalaPaths> {
  const paths = resolveHulalaPaths(root, workspaceRoot)
  await Promise.all([
    ...Object.entries(paths)
    .filter(([name]) => name !== 'root')
    .map(([, path]) => path),
  ].map(async path => {
      await mkdir(path, { recursive: true, mode: 0o700 })
      await chmod(path, 0o700).catch(() => undefined)
    }))
  return paths
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(path), `.${crypto.randomUUID()}.tmp`)
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
  await chmod(path, 0o600).catch(() => undefined)
}
