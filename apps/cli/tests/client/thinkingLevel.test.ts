import { expect, test } from 'bun:test'
import type { TerminalModelCatalog } from '../../src/tui/data/remote.js'
import {
  defaultThinkingLevelOf,
  thinkingLevelOf,
  thinkingLevelsOf,
} from '../../src/tui/data/thinkingLevel.js'

const catalog: TerminalModelCatalog = {
  default: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' },
  groups: [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        {
          id: 'deepseek-flash',
          name: 'DeepSeek-V4.1-Flash',
          reasoning: {
            efforts: [
              { id: 'off', name: 'Off', description: 'Use for simple tasks.' },
              { id: 'low', name: 'Low' },
              { id: 'max', name: 'Max', description: 'Reserve for the hardest tasks.' },
            ],
            defaultEffort: 'low',
          },
        },
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      ],
    },
    { id: 'anthropic', name: 'Anthropic', models: [{ id: 'claude-sonnet', name: 'Claude Sonnet' }] },
  ],
  failures: [],
}

test('an explicit effort is the level, whatever the default says', () => {
  const model = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off' }
  expect(thinkingLevelOf(model, catalog)).toBe('off')
})

test('an untouched route runs at the adapter default the Host applies', () => {
  const model = { provider: 'deepseek-official', model: 'deepseek-flash' }
  expect(thinkingLevelOf(model, catalog)).toBe('low')
})

test('a model without reasoning has no level', () => {
  const model = { provider: 'deepseek-official', model: 'deepseek-chat' }
  expect(thinkingLevelOf(model, catalog)).toBeUndefined()
  expect(thinkingLevelsOf(model, catalog)).toEqual([])
})

test('the levels are exactly what the adapter advertises, descriptions included', () => {
  const model = { provider: 'deepseek-official', model: 'deepseek-flash' }
  expect(thinkingLevelsOf(model, catalog).map(level => level.id)).toEqual(['off', 'low', 'max'])
  expect(thinkingLevelsOf(model, catalog)[0]?.description).toBe('Use for simple tasks.')
})

test('the default level is the Host default when it names the same route', () => {
  const model = { provider: 'deepseek-official', model: 'deepseek-flash' }
  expect(defaultThinkingLevelOf(model, catalog)).toBe('max')
  // A default pointed at another model says nothing about these levels.
  expect(defaultThinkingLevelOf({ provider: 'anthropic', model: 'claude-sonnet' }, catalog)).toBeUndefined()
})

test('a default selection without an effort falls back to the adapter default', () => {
  const bare: TerminalModelCatalog = {
    ...catalog,
    default: { provider: 'deepseek-official', model: 'deepseek-flash' },
  }
  expect(defaultThinkingLevelOf({ provider: 'deepseek-official', model: 'deepseek-flash' }, bare)).toBe('low')
})

test('no model, or no catalog yet, names only what the selection recorded', () => {
  expect(thinkingLevelOf(undefined, catalog)).toBeUndefined()
  expect(thinkingLevelOf({ provider: 'deepseek-official', model: 'deepseek-flash' }, undefined)).toBeUndefined()
  expect(thinkingLevelOf({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }, undefined))
    .toBe('max')
  expect(thinkingLevelsOf(undefined, catalog)).toEqual([])
  expect(thinkingLevelsOf({ provider: 'deepseek-official', model: 'deepseek-flash' }, undefined)).toEqual([])
  expect(defaultThinkingLevelOf(undefined, catalog)).toBeUndefined()
})
