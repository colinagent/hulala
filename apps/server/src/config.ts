import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { HulalaPaths } from '@hulala/desktop-contracts'
import { resolveHulalaPaths } from '@hulala/desktop-contracts/paths'
import { HULALA_VERSION } from '@hulala/desktop-contracts/version'

/**
 * Host process configuration.
 *
 * The Host is a daemon shell around the public Runtime; the CLI deliberately
 * carries no plugin paths, no runtime module overrides and no product feature
 * flags. A packaged Host finds its engine beside its own entry, a development
 * Host finds the repository root, and everything else is a state-root fact.
 */
export interface ServerConfig {
  host: '127.0.0.1'
  port: number
  hulalaRoot?: string
  workspaceRoot?: string
  version: string
  /**
   * Own this state root as the one long-lived Host daemon. A daemon publishes
   * `endpoint.json`, survives its spawning shell and only stops on SIGTERM.
   */
  daemon: boolean
}

export function parseServerConfig(argv = process.argv.slice(2)): ServerConfig {
  const option = (name: string): string | undefined => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const portValue = option('--port') ?? process.env.HULALA_SERVER_PORT ?? '0'
  const port = Number(portValue)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`invalid port: ${portValue}`)
  return {
    host: '127.0.0.1',
    port,
    hulalaRoot: option('--hulala-home') ?? process.env.HULALA_HOME,
    workspaceRoot: option('--workspace-root') ?? process.env.HULALA_WORKSPACE_ROOT,
    version: process.env.HULALA_VERSION ?? HULALA_VERSION,
    daemon: argv.includes('--daemon') || process.env.HULALA_HOST_DAEMON === '1',
  }
}

export async function ensureHulalaPaths(root?: string, workspaceRoot?: string): Promise<HulalaPaths> {
  const paths = resolveHulalaPaths(root, workspaceRoot)
  await Promise.all(Object.entries(paths)
    .filter(([name]) => name !== 'root')
    .map(([, path]) => path)
    .map(async path => {
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
