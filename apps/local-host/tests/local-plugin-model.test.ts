import { expect, test } from 'bun:test'
import type { Context } from '@deepseek-ai/cordis'
import { localPluginServices } from '../src/localPlugins/services.ts'
test('pins each call to its model, uses no tools or session, and follows the next selection', async () => {
  let model = 'first'
  const calls: Array<Record<string, unknown>> = []
  const ctx = { get: (name: string) => {
    if (name === 'agentLoopSelector') return { describe: async () => ({ current: 'native', selection: { provider: 'fixture', model } }) }
    if (name === 'llm') return {
      listProviders: () => [{ id: 'fixture' }],
      prepareCall: async (config: Record<string, unknown>) => ({ config, async *stream(input: Record<string, unknown>) {
        calls.push(input)
        yield { type: 'text-delta', text: '{}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } }),
    }
    return undefined
  } } as unknown as Context
  const ai = localPluginServices(ctx).ai
  const pinned = await ai.currentModel()
  model = 'second'
  expect((await ai.analyze({ model: pinned, system: 'test', prompt: '{}' })).model.model).toBe('first')
  expect((await ai.analyze({ system: 'test', prompt: '{}' })).model.model).toBe('second')
  expect(calls[0]?.tools).toEqual([])
  expect(calls[0]?.sessionId).toBeUndefined()
})
test('agent-only models are explicitly unsupported', async () => {
  const ctx = { get: (name: string) => name === 'agentLoopSelector' ? { describe: async () => ({ current: 'codex', selection: { provider: 'openai', model: 'fixture' } }) } : undefined } as unknown as Context
  await expect(localPluginServices(ctx).ai.currentModel()).rejects.toThrow('Agent')
})

test('a partial or aborted model stream never becomes an analysis result', async () => {
  const ctx = { get: (name: string) => {
    if (name === 'agentLoopSelector') return { describe: async () => ({ current: 'native', selection: { provider: 'fixture', model: 'test' } }) }
    if (name === 'llm') return {
      listProviders: () => [{ id: 'fixture' }],
      prepareCall: async (config: Record<string, unknown>) => ({ config, async *stream() {
        yield { type: 'text-delta', text: '{"partial":' }
        yield { type: 'finish', reason: { kind: 'aborted' } }
      } }),
    }
  } } as unknown as Context
  await expect(localPluginServices(ctx).ai.analyze({ system: 'test', prompt: '{}' })).rejects.toThrow('aborted')
})
