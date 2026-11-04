/**
 * Verify the vendored `ghostty-vt.wasm` against its recorded digest.
 *
 * The module is a build artifact committed so the client needs no Zig toolchain
 * and no network at install time. A committed binary is also the easiest thing
 * in the tree to swap by accident, so the digest beside it is checked before the
 * build and the tests treat it as the source of truth.
 *
 * @module hulala/scripts/check-vt-wasm
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const directory = join(root, 'apps', 'cli', 'vendor')
const module = await readFile(join(directory, 'ghostty-vt.wasm'))
const record = await readFile(join(directory, 'ghostty-vt.SHA256'), 'utf8')
const expected = /^([0-9a-f]{64})\s/gm.exec(record)?.[1]
if (expected === undefined) throw new Error('apps/cli/vendor/ghostty-vt.SHA256 has no digest on its first line')

const actual = createHash('sha256').update(module).digest('hex')
if (actual !== expected) {
  throw new Error(`ghostty-vt.wasm digest mismatch\n  expected ${expected}\n  actual   ${actual}`)
}
console.log(`ghostty-vt.wasm: ${(module.length / 1024 / 1024).toFixed(2)} MB, sha256 ${actual}`)
