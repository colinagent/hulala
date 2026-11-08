import { expect, test } from 'bun:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { TerminalModel, TerminalModelCatalog, TerminalPermissionPreset, TerminalProvider, TerminalThinkingLevel } from '../../src/tui/data/remote.js'
import { ApiKeyPanel, ProviderSelector, type ProviderPickerResult } from '../../src/tui/view/selector/login.js'
import { ModelSelector, type ModelPickerResult } from '../../src/tui/view/selector/model.js'
import { PermissionSelector, type PermissionPickerResult } from '../../src/tui/view/selector/permission.js'
import { ThinkingSelector, type ThinkingPickerResult } from '../../src/tui/view/selector/thinking.js'
import { permissionLabel } from '../../src/tui/view/permission.js'

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

const levels: readonly TerminalThinkingLevel[] = [
  { id: 'off', name: 'Off', description: 'Use for simple tasks that do not need reasoning.' },
  { id: 'low', name: 'Low', description: 'Prefer for routine or latency-sensitive tasks.' },
  { id: 'max', name: 'Max', description: 'Reserve for the hardest quality-first tasks.' },
]

function thinking(onResolve: (result: ThinkingPickerResult) => void = () => undefined): ThinkingSelector {
  const picker = new ThinkingSelector({
    model: 'deepseek-flash',
    levels,
    current: 'low',
    defaultLevel: 'max',
    color: false,
    rows: () => 30,
    onResolve,
  })
  picker.focused = true
  return picker
}

test('the thinking picker lists the advertised levels, the current one and the default', () => {
  const lines = strip(thinking().render(80))
  const rendered = lines.join('\n')
  expect(lines[0]).toBe('─'.repeat(80))
  expect(lines.at(-1)).toBe('─'.repeat(80))
  expect(rendered).toContain('Thinking Level — deepseek-flash')
  expect(rendered).toContain('→ ✓ low  Prefer for routine or latency-sensitive tasks.')
  expect(rendered).toContain('    max  Reserve for the hardest quality-first tasks. · default')
  expect(rendered).toContain('↑↓/Ctrl-N/P move · Enter select · Esc cancel')
  expect(rendered).toContain('The choice also becomes the default for new Sessions')
  for (const line of lines) expect(visibleWidth(line) <= 80).toBe(true)
})

test('the cursor starts on the current level and Enter reports it', () => {
  const seen: ThinkingPickerResult[] = []
  const picker = thinking(result => seen.push(result))
  picker.handleInput('\r')
  expect(seen).toEqual([{ kind: 'select', level: 'low' }])
})

test('arrows and Ctrl-P/Ctrl-N move with wrap-around, and Enter reports the level', () => {
  const seen: ThinkingPickerResult[] = []
  const picker = thinking(result => seen.push(result))
  picker.handleInput('\u001b[B') // ↓ → max
  picker.handleInput('\u001b[B') // ↓ wraps to off
  expect(strip(picker.render(80)).join('\n')).toContain('→   off  Use for simple tasks')
  picker.handleInput('\u000e') // Ctrl-N
  picker.handleInput('\r')
  expect(seen).toEqual([{ kind: 'select', level: 'low' }])
})

test('Escape and Ctrl-C cancel the thinking picker', () => {
  const seen: ThinkingPickerResult[] = []
  const picker = thinking(result => seen.push(result))
  picker.handleInput('\u001b')
  picker.handleInput('\u0003')
  expect(seen).toEqual([{ kind: 'cancel' }, { kind: 'cancel' }])
})

test('the thinking picker never paints past a narrow terminal', () => {
  const lines = strip(thinking().render(28))
  for (const line of lines) expect(visibleWidth(line) <= 28).toBe(true)
})

function permission(
  onResolve: (result: PermissionPickerResult) => void = () => undefined,
  overrides: Partial<{ current: string; defaultPreset: string; presets: readonly TerminalPermissionPreset[] }> = {},
): PermissionSelector {
  const picker = new PermissionSelector({
    presets: overrides.presets ?? [
      { value: 'read-only', name: 'read-only' },
      { value: 'workspace-write', name: 'workspace-write' },
      { value: 'danger-full-access', name: 'danger-full-access' },
    ],
    current: overrides.current ?? 'workspace-write',
    defaultPreset: overrides.defaultPreset ?? 'workspace-write',
    color: false,
    rows: () => 30,
    onResolve,
  })
  picker.focused = true
  return picker
}

test('the permission selector ticks the Session preset and badges the default separately', () => {
  const lines = strip(permission().render(80))
  const rendered = lines.join('\n')
  expect(lines[0]).toBe('─'.repeat(80))
  expect(lines.at(-1)).toBe('─'.repeat(80))
  expect(rendered).toContain('Permission — Workspace Write')
  expect(rendered).toContain('→ ✓ Workspace Write  default')
  expect(rendered).toContain('    Read Only')
  expect(rendered).toContain('    Full access')
  expect(rendered).toContain('↑↓/Ctrl-N/P move · Enter apply · Ctrl-S store default · Esc cancel')
  expect(rendered).toContain('Ctrl-S also makes the choice the default for new Sessions')
  for (const line of lines) expect(visibleWidth(line) <= 80).toBe(true)
})

test('Enter applies the cursor preset and Ctrl-S also stores it as the default', () => {
  const seen: PermissionPickerResult[] = []
  const picker = permission(result => seen.push(result))
  picker.handleInput('\u001b[B') // ↓ to Full access
  picker.handleInput('\r')
  picker.handleInput('\u0013') // Ctrl-S stores the same row
  expect(seen).toEqual([
    { kind: 'select', preset: 'danger-full-access' },
    { kind: 'save', preset: 'danger-full-access' },
  ])
})

test('Escape and Ctrl-C cancel the permission selector', () => {
  const seen: PermissionPickerResult[] = []
  const picker = permission(result => seen.push(result))
  picker.handleInput('\u001b')
  picker.handleInput('\u0003')
  expect(seen).toEqual([{ kind: 'cancel' }, { kind: 'cancel' }])
})

test('a custom preset keeps its configured name, and a current value it cannot show is only in the title', () => {
  const presets = [
    { value: 'read-only', name: 'read-only' },
    { value: 'team-wide', name: 'Team wide', description: 'Every directory on this machine.' },
  ]
  const rendered = strip(permission(undefined, { presets, current: 'custom', defaultPreset: 'read-only' }).render(80)).join('\n')
  expect(rendered).toContain('Permission — Custom')
  expect(rendered).toContain('Team wide  Every directory on this machine.')
  expect(rendered).toContain('Read Only  default')
  // `custom` is derived-only: it is never a row, so nothing is ticked.
  expect(rendered).not.toContain('✓')
})

test('the permission selector never paints past a narrow terminal', () => {
  const lines = strip(permission().render(32))
  for (const line of lines) expect(visibleWidth(line) <= 32).toBe(true)
})

test('permission labels name the built-in presets and leave unknown keys readable', () => {
  expect(permissionLabel('read-only')).toBe('Read Only')
  expect(permissionLabel('workspace-write')).toBe('Workspace Write')
  expect(permissionLabel('danger-full-access')).toBe('Full access')
  expect(permissionLabel('custom')).toBe('Custom')
  expect(permissionLabel('auto')).toBe('Auto review')
  expect(permissionLabel('team-wide', 'Team wide')).toBe('Team wide')
  expect(permissionLabel('team-wide')).toBe('Team Wide')
  expect(permissionLabel('团队')).toBe('团队')
})
