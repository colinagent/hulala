import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-authorization'
import { createHarnessPatch, harnessWebCommand, resolveRuntimePaths } from '../src/index'
import { bootRepositoryHarness } from '../src/in-process'

test('resolves every runtime path below an injected HULALA root', () => {
  const paths = resolveRuntimePaths({ root: '/tmp/hulala-runtime-test' })
  expect(paths.workspaceDir).toBe('/tmp/hulala-runtime-test/workspace')
  expect(Object.values(paths).every(path => path.startsWith('/tmp/hulala-runtime-test'))).toBeTrue()
})

test('builds a Harness patch from reusable runtime descriptors', () => {
  expect(createHarnessPatch({
    defaultRuntime: 'test',
    selectorPlugin: 'selector',
    runtimes: [{ id: 'test', name: 'Test', package: 'test-agent' }],
  })).toEqual([
    { id: 'agent-loop', disabled: true },
    { id: 'code-runtime', disabled: true },
    { insert: [
      { id: 'agent-loop-runtime', name: 'test-agent' },
      {
        id: 'agent-loop-selector',
        name: 'selector',
        config: {
          defaultRuntime: 'test',
          entryId: 'agent-loop-runtime',
          runtimes: { test: { name: 'Test', package: 'test-agent' } },
        },
      },
    ] },
  ])
})

test('rejects a profile whose default runtime is absent', () => {
  expect(() => createHarnessPatch({
    defaultRuntime: 'missing',
    selectorPlugin: 'selector',
    runtimes: [],
  })).toThrow('unknown default runtime')
})

test('Desktop Runtime starts Harness without opening an external browser', () => {
  expect(harnessWebCommand('/bin/bun', '/runtime/dsh.js', '/tmp/profile.json', '127.0.0.1', 43140)).toEqual([
    '/bin/bun',
    '/runtime/dsh.js',
    'web',
    '--patch', '/tmp/profile.json',
    '--host', '127.0.0.1',
    '--port', '43140',
    '--no-open',
  ])
})

test('boots the public Harness profile in the caller process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-in-process-runtime-'))
  const repositoryRoot = join(import.meta.dir, '..', '..', '..')
  const runtime = await bootRepositoryHarness({
    repositoryRoot,
    paths: { root },
    environment: { DSH_TELEMETRY_DISABLED: '1' },
  })
  try {
    expect(runtime.state()).toBe('running')
    expect(runtime.ctx.get('sessions')).toBeDefined()
    expect(runtime.ctx.get('apiProxy')).toBeDefined()
    expect(runtime.ctx.get('authorization')).toBeDefined()
    expect(runtime.ctx.authorization.list().some(entry => entry.key === 'llm-pi-ai/openai-codex')).toBeTrue()
    expect(runtime.ctx.get('workspaceRegistry')).toBeDefined()
    expect(runtime.ctx.get('agentLoopSelector')).toBeDefined()
    expect(runtime.ctx.get('webServer')).toBeUndefined()
  } finally {
    await runtime.stop()
    await rm(root, { recursive: true, force: true })
  }
  expect(runtime.state()).toBe('stopped')
})
