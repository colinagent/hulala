import { afterEach, expect, test } from 'bun:test'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import { commandCatalog, isCommandLine, resolveHostCommand, setHostCommands } from '../../src/tui/commandCatalog.js'
import { setActiveLanguage } from '../../src/tui/i18n/index.js'

afterEach(() => {
  setHostCommands([])
  setActiveLanguage('en')
})

const compact = {
  name: 'compact',
  description: 'Compact older conversation history',
  definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-compact'),
}

test('a Host row joins the catalog in its own group', () => {
  setHostCommands([compact])
  const entry = commandCatalog().find(candidate => candidate.name === 'compact')
  expect(entry).toEqual({ name: 'compact', description: 'Compact older conversation history', group: 'host', hint: '' })
  // The client's own rows keep their order and shortcuts.
  expect(commandCatalog()[0]?.name).toBe('help')
})

test('a Host row speaks the interface language without a client release', () => {
  setActiveLanguage('zh-CN')
  setHostCommands([compact])
  expect(commandCatalog().find(candidate => candidate.name === 'compact')?.description).toBe('压缩以上对话内容')
})

test('a Host row a client command already owns is not offered twice', () => {
  setHostCommands([{ name: 'status', description: 'Host status' }])
  expect(commandCatalog().filter(candidate => candidate.name === 'status')).toHaveLength(1)
  expect(commandCatalog().find(candidate => candidate.name === 'status')?.group).toBe('session')
})

test('the registered name and the first-party Chinese spelling both resolve', () => {
  setHostCommands([compact])
  expect(resolveHostCommand('compact')?.name).toBe('compact')
  expect(resolveHostCommand('压缩')?.name).toBe('compact')
  expect(resolveHostCommand('compact-old')).toBeUndefined()
})

test('a host row that takes free-form input carries its hint', () => {
  setHostCommands([{ name: 'goal', description: 'Goal', input: { hint: 'goal text' } }])
  expect(commandCatalog().find(candidate => candidate.name === 'goal')?.argumentHint).toBe('goal text')
})

test('a pasted path is a prompt, a bare word is a command', () => {
  // The failure this pins: `/tmp/...` starts with the slash a command starts
  // with, so submitting a pasted image path answered "unknown command".
  expect(isCommandLine('/help')).toBe(true)
  expect(isCommandLine('/model deepseek/x')).toBe(true)
  expect(isCommandLine('/nope')).toBe(true)
  expect(isCommandLine('/tmp/hulala-pastes/paste-20261117-222027-0d97cf22.png')).toBe(false)
  expect(isCommandLine('/var/folders/gy/x/T/hulala-pastes/paste-a.png')).toBe(false)
  expect(isCommandLine('/Users/me/shot.png')).toBe(false)
  expect(isCommandLine('  /tmp/a.png  ')).toBe(false)
  expect(isCommandLine('hello')).toBe(false)
  expect(isCommandLine('/')).toBe(false)
  expect(isCommandLine('/ screenshot.png')).toBe(false)
})
