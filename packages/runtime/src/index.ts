import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface RuntimePaths {
  root: string
  configDir: string
  /** DeepSeek Harness home: profiles, sessions, credentials, Host-level patches. */
  harnessDir: string
  dataDir: string
  workspaceDir: string
  runtimeDir: string
  logsDir: string
  cacheDir: string
}

export type RuntimeState = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

export function resolveRuntimePaths(
  input: Partial<RuntimePaths> & { root?: string } = {},
): RuntimePaths {
  const root = resolve(input.root ?? process.env.HULALA_HOME ?? join(homedir(), '.hulala'))
  return {
    root,
    configDir: resolve(input.configDir ?? join(root, 'config')),
    harnessDir: resolve(input.harnessDir ?? join(root, 'harness')),
    dataDir: resolve(input.dataDir ?? join(root, 'server')),
    workspaceDir: resolve(input.workspaceDir ?? join(root, 'workspace')),
    runtimeDir: resolve(input.runtimeDir ?? join(root, 'runtime')),
    logsDir: resolve(input.logsDir ?? join(root, 'logs')),
    cacheDir: resolve(input.cacheDir ?? join(root, 'cache')),
  }
}

export async function ensureRuntimePaths(paths: RuntimePaths): Promise<void> {
  await Promise.all(Object.entries(paths)
    .filter(([name]) => name !== 'root')
    .map(([, path]) => mkdir(path, { recursive: true, mode: 0o700 })))
}
