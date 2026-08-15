import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'

import AgentLoopSelector, { defaultWorkspacePath, ensureDefaultWorkspace, healthPayload, runtimeSelection } from '../src/index.ts'

test('reports a stable local health identity', () => {
  assert.deepEqual(healthPayload('1.2.3', 42, '2026-08-15T00:00:00.000Z'), {
    name: 'loopwithai', version: '1.2.3', pid: 42, startedAt: '2026-08-15T00:00:00.000Z',
  })
})

test('uses a cross-platform default workspace below the supplied home directory', () => {
  assert.equal(defaultWorkspacePath('/home/colin'), '/home/colin/.lwa/workspace')
})

test('creates and registers the default workspace when the registry is empty', async () => {
  const directories: Array<{ path: string; recursive: boolean }> = []
  const created: string[] = []
  const registry = {
    list: () => created,
    async create(path: string) { created.push(path); return {} as never },
  }
  const result = await ensureDefaultWorkspace(registry as never, '/test/home', async (path, options) => {
    directories.push({ path, recursive: options.recursive })
  })
  assert.equal(result, '/test/home/.lwa/workspace')
  assert.deepEqual(directories, [{ path: '/test/home/.lwa/workspace', recursive: true }])
  assert.deepEqual(created, ['/test/home/.lwa/workspace'])
})

test('preserves an existing workspace without touching the filesystem', async () => {
  let directoryCreated = false
  const result = await ensureDefaultWorkspace({
    list: () => [{ id: 'existing' }],
    create: async () => { throw new Error('must not create') },
  } as never, '/test/home', async () => { directoryCreated = true })
  assert.equal(result, undefined)
  assert.equal(directoryCreated, false)
})

test('serializes replacement and updates state only after success', async () => {
  const updates: string[] = []
  let transformIndex: ((html: string) => string) | undefined
  const tree = { resolve: () => entry }
  const entry = {
    options: { name: 'pi-package' },
    parent: { tree },
    async update(options: { name?: string }) {
      updates.push(options.name ?? '')
      this.options.name = options.name ?? this.options.name
    },
  }
  const ctx = new Context()
  ctx.provide('loader', tree as never)
  ctx.provide('webServer', {
    register: () => () => {},
    tapIndex: (transform: (html: string) => string) => {
      transformIndex = transform
      return () => {}
    },
  } as never)
  ctx.provide('workspaceRegistry', {
    list: () => [{ id: 'existing-workspace' }],
    create: async () => { throw new Error('must not create a fallback workspace') },
  } as never)
  const fiber = ctx.plugin(AgentLoopSelector, {
    defaultRuntime: 'pi',
    entryId: 'agent-loop',
    runtimes: {
      pi: { name: 'Pi', package: 'pi-package' },
      deepseek: { name: 'DeepSeek', package: 'deepseek-package' },
    },
  })
  await fiber
  const injected = transformIndex?.('<html><body></body></html>') ?? ''
  assert.match(injected, /<script type="module" src="\/loopwithai\/runtime-ui\.js"><\/script>/)
  assert.doesNotMatch(injected, /id="loopwithai-runtime"/)
  await ctx.agentLoopSelector.activate('deepseek')
  assert.deepEqual(updates, ['deepseek-package'])
  assert.equal(ctx.agentLoopSelector.current(), 'deepseek')
  ctx.agentLoopSelector.selectModel('deepseek', 'deepseek-v4-flash', 'high')
  assert.deepEqual(runtimeSelection(), {
    runtime: 'deepseek', provider: 'deepseek', model: 'deepseek-v4-flash', thinkingLevel: 'high',
  })

  await ctx.agentLoopSelector.activate('pi')
  assert.deepEqual(updates, ['deepseek-package', 'pi-package'])
  assert.equal(ctx.agentLoopSelector.current(), 'pi')

  entry.update = async () => { throw new Error('import failed') }
  await assert.rejects(ctx.agentLoopSelector.activate('deepseek'), /import failed/)
  assert.equal(ctx.agentLoopSelector.current(), 'pi')
  await ctx.fiber.dispose()
})
