import { expect, test } from 'bun:test'
import { createHarnessPatch, resolveRuntimePaths } from '../src/index'

test('resolves every runtime path below an injected LWA root', () => {
  const paths = resolveRuntimePaths({ root: '/tmp/lwa-runtime-test' })
  expect(paths.workspaceDir).toBe('/tmp/lwa-runtime-test/workspace')
  expect(Object.values(paths).every(path => path.startsWith('/tmp/lwa-runtime-test'))).toBeTrue()
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
