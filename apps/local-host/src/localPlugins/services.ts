import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ModelIdentity } from '@hulala/plugin-sdk'
import type { PluginServices } from './manager.ts'
import { z } from 'zod'
const modelSchema = z.object({ provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().optional() })
/** One-shot, tool-free calls through the already configured Harness adapter. */
export function localPluginServices(ctx: Context): PluginServices {
  async function currentModel(): Promise<ModelIdentity> {
    const selector = ctx.get('agentLoopSelector') as { describe(): Promise<unknown> } | undefined
    const state = await selector?.describe() as { current?: string; selection?: { provider?: string; model?: string; thinkingLevel?: string } } | undefined
    if (!state?.selection || ['pi', 'codex', 'claude'].includes(state.current ?? '')) throw new Error('当前 Agent 模式不支持后台模型分析，请选择直接模型接口。')
    const model = modelSchema.parse({
      provider: state.selection.provider, model: state.selection.model,
      ...(state.selection.thinkingLevel ? { reasoningEffort: state.selection.thinkingLevel } : {}),
    })
    if (!ctx.get('llm')?.listProviders().some(p => p.id === model.provider)) throw new Error('当前模型没有可用的直接调用接口。')
    return model
  }
  return {
    ai: {
      currentModel,
      async analyze(input) {
        const model = input.model ? modelSchema.parse(input.model) : await currentModel()
        const llm = ctx.get('llm')
        if (!llm) throw new Error('模型服务不可用')
        const signal = AbortSignal.any([AbortSignal.timeout(90_000), ...(input.signal ? [input.signal] : [])])
        const prepared = await llm.prepareCall({
          provider: model.provider, model: model.model,
          ...(model.reasoningEffort ? { reasoningEffort: ReasoningEffortId(model.reasoningEffort) } : {}),
          maxTokens: Math.min(4096, Math.max(256, input.maxTokens ?? 2500)),
        }, signal)
        let text = ''
        let completed = false
        for await (const chunk of prepared.stream({
          ...prepared.config, system: input.system,
          messages: [createUserMessage({ content: [{ type: 'text', text: input.prompt }], source: { kind: 'user' } })],
          tools: [], signal,
        })) {
          if (chunk.type === 'text-delta') text += chunk.text
          if (text.length > 100_000) throw new Error('模型输出超出长度限制')
          if (chunk.type === 'finish') {
            if (chunk.reason.kind !== 'stop') throw new Error('模型分析未完整完成：' + chunk.reason.kind)
            completed = true
          }
        }
        if (!completed || !text.trim()) throw new Error('模型未返回完整结果')
        return { text, model }
      },
    },
    secrets(id) {
      const ref = (name: string) => {
        if (!/^[a-z][a-zA-Z0-9.-]{0,79}$/.test(name)) throw new Error('invalid secret name')
        // Encode instead of replacing punctuation, avoiding cross-plugin collisions.
        return credentialRef('HULALA_PLUGIN_' + Buffer.from(id).toString('hex').toUpperCase() + '_' + Buffer.from(name).toString('hex').toUpperCase())
      }
      const provider = () => { const value = ctx.get('credentials'); if (!value) throw new Error('凭据服务不可用'); return value }
      return {
        resolve: async name => (await provider().resolve(ref(name)))?.value,
        describe: async name => ({ configured: (await provider().describe(ref(name))).configured }),
        set: async (name, value) => { await provider().set(ref(name), value) },
        unset: async name => { await provider().unset(ref(name)) },
      }
    },
  }
}
