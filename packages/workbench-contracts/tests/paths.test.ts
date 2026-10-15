import { expect, test } from 'bun:test'
import { defaultHulalaRoot, defaultHulalaWorkspaceRoot, resolveHulalaPaths } from '../src/paths'

test('keeps product state under ~/.config/hulala and workspaces under ~/hulala-workspace', () => {
  expect(defaultHulalaRoot('/Users/example')).toBe('/Users/example/.config/hulala')
  expect(defaultHulalaWorkspaceRoot('/Users/example')).toBe('/Users/example/hulala-workspace')
  expect(resolveHulalaPaths('/Users/example/.config/hulala', '/Users/example/hulala-workspace')).toMatchObject({
    root: '/Users/example/.config/hulala',
    config: '/Users/example/.config/hulala/config',
    workspaceRoot: '/Users/example/hulala-workspace',
    workspace: '/Users/example/hulala-workspace/workspace',
  })
})

test('supports independent injected state and workspace roots', () => {
  const paths = resolveHulalaPaths('/tmp/hulala-test-root', '/tmp/hulala-workspaces')
  expect(paths.root).toBe('/tmp/hulala-test-root')
  for (const [name, path] of Object.entries(paths)) {
    if (name === 'root' || name === 'workspaceRoot' || name === 'workspace') continue
    expect(path.startsWith(`${paths.root}/`), name).toBeTrue()
  }
  expect(paths.workspaceRoot).toBe('/tmp/hulala-workspaces')
  expect(paths.workspace).toBe('/tmp/hulala-workspaces/workspace')
})
