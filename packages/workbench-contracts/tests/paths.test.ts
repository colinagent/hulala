import { expect, test } from 'bun:test'
import { join, resolve, sep } from 'node:path'
import { defaultHulalaRoot, defaultHulalaWorkspaceRoot, resolveHulalaPaths } from '../src/paths'

test('keeps product state under ~/.config/hulala and workspaces under ~/hulala-workspace', () => {
  const home = resolve('test-home')
  expect(defaultHulalaRoot(home)).toBe(join(home, '.config', 'hulala'))
  expect(defaultHulalaWorkspaceRoot(home)).toBe(join(home, 'hulala-workspace'))
  expect(resolveHulalaPaths(join(home, '.config', 'hulala'), join(home, 'hulala-workspace'))).toMatchObject({
    root: join(home, '.config', 'hulala'),
    config: join(home, '.config', 'hulala', 'config'),
    workspaceRoot: join(home, 'hulala-workspace'),
    workspace: join(home, 'hulala-workspace', 'workspace'),
  })
})

test('supports independent injected state and workspace roots', () => {
  const root = resolve('hulala-test-root'), workspaces = resolve('hulala-workspaces')
  const paths = resolveHulalaPaths(root, workspaces)
  expect(paths.root).toBe(root)
  for (const [name, path] of Object.entries(paths)) {
    if (name === 'root' || name === 'workspaceRoot' || name === 'workspace') continue
    expect(path.startsWith(`${paths.root}${sep}`), name).toBeTrue()
  }
  expect(paths.workspaceRoot).toBe(workspaces)
  expect(paths.workspace).toBe(join(workspaces, 'workspace'))
})
