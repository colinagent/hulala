import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveRuntimeRoot } from '../../src/plugins/host.js'

/** Create a version directory that looks like an installed runtime. */
async function runtime(root: string, id: string): Promise<string> {
  const dir = join(root, 'runtime', 'client', 'versions', id, 'runtime')
  const manifest = join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  await mkdir(join(manifest, '..'), { recursive: true })
  await writeFile(manifest, '{"name":"@deepseek-ai/dsh"}')
  return dir
}

test('an installed client uses the version the installer recorded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-runtime-choice-'))
  await runtime(root, '0.2.28-aaaaaaaa')
  const active = await runtime(root, '0.3.0-bbbbbbbb')
  await writeFile(join(root, 'runtime', 'client', 'active.json'), JSON.stringify({ current: { id: '0.3.0-bbbbbbbb' } }))
  expect(resolveRuntimeRoot(root, import.meta.url)).toBe(active)
})

test('without a pointer, versions are compared as numbers, not strings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-runtime-sort-'))
  await runtime(root, '9.0.0')
  const newest = await runtime(root, '10.0.0')
  expect(resolveRuntimeRoot(root, import.meta.url)).toBe(newest)
})

test('no runtime anywhere is a readable error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-runtime-none-'))
  expect(() => resolveRuntimeRoot(root, 'file:///nowhere/cli.js')).toThrow(/Cannot find the DSH runtime/)
})
