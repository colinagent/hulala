import { expect, test } from 'bun:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { TerminalModel, TerminalModelCatalog, TerminalProvider } from '../../src/tui/data/remote.js'
import { ApiKeyPanel, ProviderSelector, type ProviderPickerResult } from '../../src/tui/view/selector/login.js'
import { ModelSelector, type ModelPickerResult } from '../../src/tui/view/selector/model.js'

const strip = (lines: readonly string[]): string[] => lines.map(line => line
  .replace(/\u001b\[[0-9;]*m/gu, '')
  .replace(/\u001b_pi:[^\u0007]*\u0007/gu, ''))

const catalog: TerminalModelCatalog = {
  default: { provider: 'deepseek-official', model: 'deepseek-flash' },
  groups: [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        {
          id: 'deepseek-flash',
          name: 'DeepSeek-V4.1-Flash',
          reasoning: {
            efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
            defaultEffort: 'low',
          },
        },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', reasoning: { efforts: [{ id: 'off', name: 'Off' }] } },
      ],
    },
    { id: 'anthropic', name: 'Anthropic', models: [{ id: 'claude-sonnet', name: 'Claude Sonnet' }] },
  ],
  failures: [],
}

function selector(onResolve: (result: ModelPickerResult) => void = () => undefined, current: TerminalModel = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }): ModelSelector {
  const model = new ModelSelector({ catalog, current, color: false, rows: () => 30, onResolve })
  model.focused = true
  return model
}

test('the model selector renders pi-style rows with the current model ticked', () => {
  const lines = strip(selector().render(96))
  expect(lines[0]).toBe('─'.repeat(96))
  expect(lines.at(-1)).toBe('─'.repeat(96))
  expect(lines.join('\n')).toContain('Only configured providers · type to filter · /login adds a provider')
  expect(lines.join('\n')).toContain('→ ✓ DeepSeek-V4.1-Flash (deepseek-flash) [deepseek-official] · default · reasoning high')
  expect(lines.join('\n')).toContain('Model Name: DeepSeek-V4.1-Flash (deepseek-flash)')
  expect(lines.join('\n')).toContain('reasoning: off / low / high')
  for (const line of lines) expect(visibleWidth(line) <= 96).toBe(true)
})

test('the current model sorts first and typing filters over id, name and provider', () => {
  const model = selector(undefined, { provider: 'anthropic', model: 'claude-sonnet' })
  expect(strip(model.render(96)).join('\n')).toContain('→ ✓ Claude Sonnet (claude-sonnet) [anthropic]')
  for (const character of 'pro') model.handleInput(character)
  const filtered = strip(model.render(96)).join('\n')
  expect(filtered).toContain('DeepSeek-V4-Pro')
  expect(filtered).not.toContain('DeepSeek-V4.1-Flash')
})

test('Tab cycles the highlighted model reasoning effort and Enter carries it', () => {
  const seen: ModelPickerResult[] = []
  const model = selector(result => seen.push(result), { provider: 'anthropic', model: 'claude-sonnet' })
  // The second row is deepseek-flash, whose default effort is `low`.
  model.handleInput('\u001b[B')
  model.handleInput('\t')
  expect(strip(model.render(96)).join('\n')).toContain('reasoning: off / low / high')
  model.handleInput('\r')
  expect(seen).toEqual([{ kind: 'select', selection: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' } }])
})

test('Ctrl-N and Ctrl-P move the model selection like the arrow keys', () => {
  const seen: ModelPickerResult[] = []
  const model = selector(result => seen.push(result), { provider: 'anthropic', model: 'claude-sonnet' })
  model.handleInput('\u000e') // Ctrl-N
  model.handleInput('\u000e')
  model.handleInput('\u0010') // Ctrl-P
  model.handleInput('\r')
  // Started on Claude Sonnet, down twice and back up once lands on the second row.
  expect(seen).toEqual([{ kind: 'select', selection: { provider: 'deepseek-official', model: 'deepseek-flash' } }])
})

test('typing /login and confirming asks for the login flow instead of a model', () => {
  const seen: ModelPickerResult[] = []
  const model = selector(result => seen.push(result))
  for (const character of '/login') model.handleInput(character)
  model.handleInput('\r')
  expect(seen).toEqual([{ kind: 'login' }])
})

test('Escape cancels the model selector', () => {
  const seen: ModelPickerResult[] = []
  const model = selector(result => seen.push(result))
  model.handleInput('\u001b')
  expect(seen).toEqual([{ kind: 'cancel' }])
})

test('an empty catalog points at /login', () => {
  const model = new ModelSelector({
    catalog: { default: { provider: 'none', model: 'none' }, groups: [], failures: [] },
    color: false,
    rows: () => 24,
    onResolve: () => undefined,
  })
  const rendered = strip(model.render(80)).join('\n')
  expect(rendered).toContain('No model providers are configured · type /login to add an API key')
  expect(rendered).toContain('No matching models')
})

const providers: readonly TerminalProvider[] = [
  { id: 'deepseek-official', name: 'DeepSeek', active: true, configured: true, source: 'file' },
  { id: 'anthropic', name: 'anthropic', active: false, configured: false, baseURL: 'https://api.anthropic.com' },
  { id: 'openai', name: 'OpenAI', active: false, configured: true, source: 'env' },
]

test('the provider selector shows each route status and filters by name', () => {
  const seen: ProviderPickerResult[] = []
  const picker = new ProviderSelector({ providers, color: false, rows: () => 30, onResolve: result => seen.push(result) })
  picker.focused = true
  const rendered = strip(picker.render(90)).join('\n')
  expect(rendered).toContain('Select a provider to add an API key:')
  expect(rendered).toContain('→ DeepSeek [deepseek-official] ✓ configured')
  expect(rendered).toContain('anthropic • not configured')
  expect(rendered).toContain('OpenAI [openai] ✓ env')
  picker.handleInput('\u000e') // Ctrl-N
  picker.handleInput('\r')
  expect(seen).toEqual([{ kind: 'select', provider: providers[1]! }])
})

test('the API-key field masks what it holds and reports the trimmed key', () => {
  const seen: Array<string | undefined> = []
  const panel = new ApiKeyPanel({ provider: providers[0]!, color: false, onResolve: value => seen.push(value) })
  panel.focused = true
  panel.handleInput('sk-plain-secret')
  const rendered = strip(panel.render(80)).join('\n')
  expect(rendered).toContain('Login to DeepSeek')
  expect(rendered).not.toContain('sk-plain-secret')
  expect(rendered).toContain('•'.repeat('sk-plain-secret'.length))
  panel.handleInput('\r')
  expect(seen).toEqual(['sk-plain-secret'])
})

test('an empty API-key field does not submit, and Escape cancels', () => {
  const seen: Array<string | undefined> = []
  const panel = new ApiKeyPanel({ provider: providers[0]!, color: false, onResolve: value => seen.push(value) })
  panel.focused = true
  panel.handleInput('\r')
  expect(seen).toEqual([])
  panel.handleInput('\u001b')
  expect(seen).toEqual([undefined])
})

test('the API-key field accepts a bracketed paste without its markers', () => {
  const seen: Array<string | undefined> = []
  const panel = new ApiKeyPanel({ provider: providers[0]!, color: false, onResolve: value => seen.push(value) })
  panel.focused = true
  panel.handleInput('\u001b[200~sk-pasted-key\u001b[201~')
  expect(strip(panel.render(80)).join('\n')).toContain('•'.repeat('sk-pasted-key'.length))
  panel.handleInput('\r')
  expect(seen).toEqual(['sk-pasted-key'])
})
