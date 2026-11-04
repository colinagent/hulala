import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('Windows compiled Host disables unsupported Bun bytecode while other targets retain it', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'scripts', 'build-bundles.ts'), 'utf8')
  expect(source).toContain("bytecode: !target.includes('windows')")
  expect(source).toContain("process.argv.includes('--native')")
  expect(source).toContain('nativeCompile ? { outfile } : { target, outfile }')
  expect(source).toContain("sourcemap: 'none'")
  expect(source).toContain('minify: true')
})
