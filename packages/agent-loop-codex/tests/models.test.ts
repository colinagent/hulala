import assert from 'node:assert/strict'
import test from 'node:test'

import { codexModelView } from '../src/index.ts'

test('maps Codex model capabilities into the Harness model picker', () => {
  assert.deepEqual(codexModelView({
    model: 'gpt-5.6-sol',
    displayName: 'GPT-5.6-Sol',
    isDefault: true,
    hidden: false,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'Deep' },
      { reasoningEffort: 'xhigh', description: 'Deeper' },
    ],
  }), {
    provider: 'openai',
    providerName: 'OpenAI',
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6-Sol',
    default: true,
    thinkingLevels: ['low', 'medium', 'high', 'xhigh'],
    defaultThinkingLevel: 'high',
  })
})

test('omits hidden or malformed Codex models', () => {
  assert.equal(codexModelView({ model: 'hidden', hidden: true }), undefined)
  assert.equal(codexModelView({ displayName: 'Missing model id' }), undefined)
})
