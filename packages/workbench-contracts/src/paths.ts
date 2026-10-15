import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { HULALA_DIRECTORY_NAMES, type HulalaPaths } from './index'

export function defaultHulalaRoot(userHome = homedir()): string {
  return join(userHome, '.config', 'hulala')
}

export function defaultHulalaWorkspaceRoot(userHome = homedir()): string {
  return join(userHome, 'hulala-workspace')
}

export function resolveHulalaPaths(
  root = process.env.HULALA_HOME || defaultHulalaRoot(),
  workspaceRoot = process.env.HULALA_WORKSPACE_ROOT || defaultHulalaWorkspaceRoot(),
): HulalaPaths {
  const canonicalRoot = resolve(root)
  const canonicalWorkspaceRoot = resolve(workspaceRoot)
  return Object.fromEntries([
    ['root', canonicalRoot],
    ...HULALA_DIRECTORY_NAMES
      .filter(name => name !== 'workspace')
      .map(name => [name, join(canonicalRoot, name)]),
    ['workspaceRoot', canonicalWorkspaceRoot],
    ['workspace', join(canonicalWorkspaceRoot, 'workspace')],
  ]) as unknown as HulalaPaths
}
