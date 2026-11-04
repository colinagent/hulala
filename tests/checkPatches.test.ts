import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addedLinesByFile, checkPatches, parsePatchKey } from '../scripts/check-patches'

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hulala-patches-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Install a fake package with the given version and files. */
function install(name: string, version: string, files: Record<string, string>): void {
  const directory = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version }))
  for (const [file, content] of Object.entries(files)) writeFileSync(join(directory, file), content)
}

/** Write a patch file that adds one line to one file, and return its relative path. */
function writePatch(file: string, line: string): string {
  mkdirSync(join(root, 'patches'), { recursive: true })
  writeFileSync(join(root, 'patches', 'p.patch'), `--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,2 @@\n context\n+${line}\n`)
  return 'patches/p.patch'
}

/** Declare the patchedDependencies map. */
function declarePatches(entries: Record<string, string>): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ patchedDependencies: entries }))
}

describe('parsePatchKey', () => {
  test('splits on the last at sign so a scoped name survives', () => {
    expect(parsePatchKey('@scope/pkg@1.2.3')).toEqual({ packageName: '@scope/pkg', version: '1.2.3' })
    expect(parsePatchKey('pkg@1.2.3')).toEqual({ packageName: 'pkg', version: '1.2.3' })
    expect(parsePatchKey('nonsense')).toBeUndefined()
    expect(parsePatchKey('pkg@')).toBeUndefined()
  })
})

describe('addedLinesByFile', () => {
  test('groups added lines per target and skips headers', () => {
    const files = addedLinesByFile(
      '--- a/x.js\n+++ b/x.js\n@@ -1 +1,2 @@\n keep\n+added one\n+added two\n--- a/y.js\n+++ b/y.js\n@@ -1 +1 @@\n+only\n',
    )
    expect([...files.keys()]).toEqual(['x.js', 'y.js'])
    expect(files.get('x.js')).toEqual(['added one', 'added two'])
    expect(files.get('y.js')).toEqual(['only'])
  })
})

describe('checkPatches', () => {
  test('accepts a patch whose added lines are present', () => {
    install('pkg', '1.0.0', { 'x.js': 'context\nadded one\n' })
    declarePatches({ 'pkg@1.0.0': writePatch('x.js', 'added one') })
    expect(checkPatches(root)).toEqual([])
  })

  test('reports a version mismatch, which bun would otherwise ignore in silence', () => {
    install('pkg', '2.0.0', { 'x.js': 'context\n' })
    declarePatches({ 'pkg@1.0.0': writePatch('x.js', 'added one') })
    const problems = checkPatches(root)
    expect(problems).toHaveLength(1)
    expect(problems[0]!.message).toContain('is NOT applied')
  })

  test('reports an artifact that upstream renamed', () => {
    install('pkg', '1.0.0', { 'x.js': 'context\n' })
    declarePatches({ 'pkg@1.0.0': writePatch('x.js', 'added one') })
    expect(checkPatches(root)[0]!.message).toContain('does not contain 1 patched line')
  })

  test('reports a package that is not installed and a malformed key', () => {
    declarePatches({ 'absent@1.0.0': 'patches/none.patch', malformed: 'patches/none.patch' })
    const messages = checkPatches(root).map(problem => problem.message)
    expect(messages.some(message => message.includes('is not installed'))).toBe(true)
    expect(messages.some(message => message.includes('not "<package>@<version>"'))).toBe(true)
  })

  test('reports a patch file that is missing from the checkout', () => {
    install('pkg', '1.0.0', { 'x.js': 'context\n' })
    declarePatches({ 'pkg@1.0.0': 'patches/gone.patch' })
    expect(checkPatches(root)[0]!.message).toContain('no patch file')
  })
})

describe('this checkout', () => {
  test('applies every patchedDependencies entry', () => {
    // The gate that matters: a stale version key would pass every other test.
    expect(checkPatches(join(import.meta.dir, '..'))).toEqual([])
  })
})
