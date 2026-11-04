import { test, expect } from 'bun:test'
import { defaultHulalaRoot, defaultHulalaWorkspaceRoot, resolveHulalaPaths } from '../src/paths'

test('keeps product state under ~/.hulala and workspaces under ~/hulala-workspace', () => {
  expect(defaultHulalaRoot('/Users/colin')).toBe('/Users/colin/.hulala')
  expect(defaultHulalaWorkspaceRoot('/Users/colin')).toBe('/Users/colin/hulala-workspace')
  expect(resolveHulalaPaths('/Users/colin/.hulala', '/Users/colin/hulala-workspace')).toMatchObject({
    root: '/Users/colin/.hulala',
    config: '/Users/colin/.hulala/config',
    workspaceRoot: '/Users/colin/hulala-workspace',
    workspace: '/Users/colin/hulala-workspace/workspace',
  })
})

test('supports independent injected state and workspace roots', () => {
  const paths = resolveHulalaPaths('/tmp/hulala-test-root', '/tmp/hulala-workspaces')
  expect(paths.root).toBe('/tmp/hulala-test-root')
  for (const [name, path] of Object.entries(paths)) {
    if (name === 'root' || name === 'workspaceRoot' || name === 'workspace') continue
    expect(path.startsWith(`${paths.root}/`)).toBe(true)
  }
  expect(paths.workspaceRoot).toBe('/tmp/hulala-workspaces')
  expect(paths.workspace).toBe('/tmp/hulala-workspaces/workspace')
})
