import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureRuntimeDependencies, systemProxy } from '../src/distribution/dependencies.js'

test('an installed dependency tree is left alone instead of fetched again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala dependencies '))
  try {
    const runtime = join(root, 'runtime')
    await mkdir(join(runtime, 'node_modules'), { recursive: true })
    await writeFile(join(runtime, 'package.json'), JSON.stringify({ dependencies: { koffi: '3.1.6' } }))
    await writeFile(join(runtime, 'node_modules/.hulala-runtime.json'), '{"format":1}')
    // No assets at all: a tree with its own marker must not reach the network.
    expect(await ensureRuntimeDependencies(runtime, undefined)).toEqual({ source: 'present' })
    // A package that declares no dependencies needs nothing either.
    const empty = join(root, 'empty')
    await mkdir(empty, { recursive: true })
    await writeFile(join(empty, 'package.json'), '{"name":"hulala"}')
    expect(await ensureRuntimeDependencies(empty, undefined)).toEqual({ source: 'present' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a dependency tree without a published lock is an error, not a silent empty install', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala dependencies missing '))
  try {
    const runtime = join(root, 'runtime')
    await mkdir(runtime, { recursive: true })
    await writeFile(join(runtime, 'package.json'), JSON.stringify({ dependencies: { koffi: '3.1.6' } }))
    await expect(ensureRuntimeDependencies(runtime, undefined)).rejects.toThrow('publishes no dependency lock')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('an explicit proxy in the environment is never replaced', async () => {
  expect(await systemProxy({ HTTPS_PROXY: 'http://corporate.invalid:3128' })).toBeUndefined()
  expect(await systemProxy({ ALL_PROXY: 'socks5://127.0.0.1:1080' })).toBeUndefined()
})
