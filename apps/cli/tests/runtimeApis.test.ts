import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The shipped client runs on Node, and only the development checkout runs on
 * Bun. A `Bun.*` call outside the one explicitly guarded Bun-only branch
 * therefore passes every test here and throws in the artifact users install —
 * which is how `hulala update --background` once shipped as `Bun is not defined`.
 *
 * This walks the CLI sources and fails on a bare `Bun.` reference. `editor/pty.ts`
 * is the single exception: it adapts Bun's built-in pty and returns early when
 * `process.versions.bun` is unset.
 */
const SOURCE_ROOTS = [
  join(import.meta.dirname, '..', 'src'),
  // The Host ships in the same archive and also runs on Node.
  join(import.meta.dirname, '..', '..', 'server', 'src'),
]
const ALLOWED = new Set([join(import.meta.dirname, '..', 'src', 'tui', 'editor', 'pty.ts')])

function sources(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) found.push(...sources(path))
    else if (path.endsWith('.ts')) found.push(path)
  }
  return found
}

describe('the shipped client', () => {
  test('never calls a Bun API outside the guarded Bun-only pty adapter', () => {
    const offenders: string[] = []
    for (const path of SOURCE_ROOTS.flatMap(root => sources(root))) {
      if (ALLOWED.has(path)) continue
      // Comments explain the rule and legitimately name `Bun.spawn`.
      const code = readFileSync(path, 'utf8')
        .split('\n')
        .filter(line => !/^\s*(\*|\/\/|\/\*)/u.test(line))
        .join('\n')
      if (/\bBun\.\w/u.test(code)) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })

  test('spawns through node:child_process, which both runtimes implement', () => {
    const source = readFileSync(join(SOURCE_ROOTS[0]!, 'spawn.ts'), 'utf8')
    expect(source).toContain("from 'node:child_process'")
    // A detached child must be unref'd, or the parent waits for it on exit.
    expect(source).toContain('detached: true')
    expect(source).toContain('child.unref()')
  })
})
