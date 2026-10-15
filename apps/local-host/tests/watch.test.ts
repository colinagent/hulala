import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { resolveWorkspaceWatchPath } from '../src/watch.ts'

describe('workspace watch paths', () => {
  test('converts nested watcher filenames to absolute workspace paths', () => {
    const workspacePath = resolve('workspace-root')

    expect(resolveWorkspaceWatchPath(workspacePath, 'raw/books/2026/notes.md')).toBe(
      resolve(workspacePath, 'raw/books/2026/notes.md'),
    )
  })

  test('maps a root-level watcher notification to the workspace root', () => {
    const workspacePath = resolve('workspace-root')

    expect(resolveWorkspaceWatchPath(workspacePath, '.')).toBe(workspacePath)
  })
})
