import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { imeSourcePath, publishImeHelper } from '../../src/tui/editor/imeHelper.js'

/** A checkout shaped like this repository, with the helper's C source. */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'hulala-ime-checkout-'))
  mkdirSync(join(root, 'apps', 'cli', 'native'), { recursive: true })
  writeFileSync(join(root, 'apps', 'cli', 'native', 'ime.c'), 'int main(void) { return 0; }\n')
  return root
}

/** The module's own directory inside that checkout. */
function from(root: string): string {
  return join(root, 'apps', 'cli', 'src', 'tui', 'editor')
}

/** A compiler stand-in that writes a runnable file instead of calling clang. */
function countingCompiler(): { compile: (source: string, destination: string) => boolean, calls: () => number } {
  let calls = 0
  return {
    compile: (_source, destination) => {
      calls += 1
      writeFileSync(destination, '#!/bin/sh\nexit 0\n')
      chmodSync(destination, 0o755)
      return true
    },
    calls: () => calls,
  }
}

test('the C source is found by walking up from the module', () => {
  const root = checkout()
  expect(imeSourcePath(from(root))).toBe(join(root, 'apps', 'cli', 'native', 'ime.c'))
  // Outside a checkout there is nothing to build from.
  expect(imeSourcePath(mkdtempSync(join(tmpdir(), 'hulala-ime-empty-')))).toBeUndefined()
})

test('a source checkout builds the helper into bin/, once per source change', () => {
  const root = checkout()
  const bin = join(mkdtempSync(join(tmpdir(), 'hulala-ime-data-')), 'bin')
  const compiler = countingCompiler()
  const options = { compile: compiler.compile, from: from(root), platform: 'darwin' as const }

  const built = publishImeHelper(bin, options)
  expect(built).toBe(join(bin, 'ime'))
  expect(statSync(built!).mode & 0o777).toBe(0o755)
  // An unchanged source is not rebuilt, so a start costs one compiler run in total.
  expect(publishImeHelper(bin, options)).toBe(join(bin, 'ime'))
  expect(compiler.calls()).toBe(1)

  // A newer source rebuilds; a touch older than the binary does not.
  const source = join(root, 'apps', 'cli', 'native', 'ime.c')
  utimesSync(source, new Date(), new Date(Date.now() + 60_000))
  expect(publishImeHelper(bin, options)).toBe(join(bin, 'ime'))
  expect(compiler.calls()).toBe(2)
})

test('a failed build never removes a helper that already works', () => {
  const root = checkout()
  const bin = join(mkdtempSync(join(tmpdir(), 'hulala-ime-data-')), 'bin')
  const working = { compile: countingCompiler().compile, from: from(root), platform: 'darwin' as const }
  const built = publishImeHelper(bin, working)!
  const before = statSync(built).mtimeMs

  const failing = { compile: () => false, from: from(root), platform: 'darwin' as const }
  utimesSync(join(root, 'apps', 'cli', 'native', 'ime.c'), new Date(), new Date(Date.now() + 60_000))
  expect(publishImeHelper(bin, failing)).toBe(built)
  expect(statSync(built).mtimeMs).toBe(before)
  // Nothing half-written is left beside it.
  expect(existsSync(`${built}.${process.pid}.tmp`)).toBe(false)
})

test('a failed first build reports that there is no helper', () => {
  const root = checkout()
  const bin = join(mkdtempSync(join(tmpdir(), 'hulala-ime-data-')), 'bin')
  expect(publishImeHelper(bin, { compile: () => false, from: from(root), platform: 'darwin' })).toBeUndefined()
  expect(existsSync(join(bin, 'ime'))).toBe(false)
})

test('only macOS has an input-source helper', () => {
  const root = checkout()
  const bin = join(mkdtempSync(join(tmpdir(), 'hulala-ime-data-')), 'bin')
  const compile = countingCompiler()
  expect(publishImeHelper(bin, { compile: compile.compile, from: from(root), platform: 'linux' })).toBeUndefined()
  expect(compile.calls()).toBe(0)
})
