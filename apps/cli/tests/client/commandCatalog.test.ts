import { afterEach, expect, test } from 'bun:test'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import { clientCommandName, commandCatalog, isCommandLine, resolveHostCommand, setHostCommands } from '../../src/tui/commandCatalog.js'
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

test('the whitelist is the registry: a known word is a command, anything else is a prompt', () => {
  // Every row and every alias dispatches, with or without an argument.
  for (const entry of commandCatalog()) {
    expect(isCommandLine(`/${entry.name}`)).toBe(true)
    expect(isCommandLine(`/${entry.name} some argument`)).toBe(true)
  }
  // Aliases are commands even though they are not rows of their own.
  expect(isCommandLine('/exit')).toBe(true)
  expect(isCommandLine('/name a title')).toBe(true)
  expect(isCommandLine('/shell')).toBe(true)
  expect(isCommandLine('/palette')).toBe(true)
  expect(clientCommandName('EXIT')).toBe('quit')
  // A pasted path starts with the same slash, and is never a command.
  expect(isCommandLine('/tmp/hulala-pastes/paste-20261117-222027-0d97cf22.png')).toBe(false)
  expect(isCommandLine('/var/folders/gy/x/T/hulala-pastes/paste-a.png')).toBe(false)
  expect(isCommandLine('/Users/me/shot.png')).toBe(false)
  expect(isCommandLine('  /tmp/a.png  ')).toBe(false)
  // A word nobody registered is a prompt, the way pi treats it.
  expect(isCommandLine('/nope')).toBe(false)
  expect(isCommandLine('/hlep')).toBe(false)
  expect(isCommandLine('/')).toBe(false)
  expect(isCommandLine('hello')).toBe(false)
})

test('a Host command joins the whitelist only while its Session offers it', () => {
  expect(isCommandLine('/compact')).toBe(false)
  setHostCommands([compact])
  expect(isCommandLine('/compact')).toBe(true)
  expect(isCommandLine('/compact extra')).toBe(true)
})

test('no name or alias is registered twice', () => {
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const row of commandCatalog()) {
    for (const word of [row.name]) {
      if (seen.has(word)) duplicates.push(word)
      seen.add(word)
    }
  }
  // Aliases are not palette rows, so read them from the registry through the
  // lookup that dispatches them: each one has to resolve to exactly one row.
  for (const alias of ['exit', 'name', 'shell', 'palette']) {
    if (clientCommandName(alias) === undefined) duplicates.push(`unresolved ${alias}`)
  }
  expect(duplicates).toEqual([])
})
