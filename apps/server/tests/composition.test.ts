import { expect, test } from 'bun:test'
import type { Context } from '@deepseek-ai/cordis'
import { readComposition } from '../src/plugins/composition.ts'

/** Fiber state numbers as DSH names them. */
const ACTIVE = 2
const FAILED = 3

/** One Loader entry, in the shape `readComposition` reads. */
function entry(id: string, name: string, state: number): unknown {
  return {
    id,
    disabled: false,
    fiber: { state },
    options: { name },
    parent: { tree: { ctx: { baseUrl: 'file:///profile/' } } },
  }
}

/** A context with just the two services the roster reads. */
function fakeContext(options: {
  entries: readonly unknown[]
  skips?: readonly { name: string, reason: string }[]
}): Context {
  return {
    root: { loader: { entries: () => options.entries } },
    get: (name: string) => {
      if (name === 'hulalaProfileSkips') return options.skips
      if (name === 'pluginPackages') return { packageOf: () => ({ version: '9.9.9' }) }
      return undefined
    },
  } as unknown as Context
}

test('a failed entry is reported with the version the Host resolved', () => {
  const composition = readComposition(fakeContext({
    entries: [entry('include:a', '@deepseek-ai/dsh-base', ACTIVE), entry('include:b', '@colinagent/dsh-mcp', FAILED)],
  }))
  expect(composition.degraded.map(row => `${row.module}:${row.state}`)).toEqual(['@colinagent/dsh-mcp:failed'])
  expect(composition.degraded[0]?.version).toBe('9.9.9')
  // Failures lead the roster: a reader with 128 rows to look at starts with what
  // is broken.
  expect(composition.plugins[0]?.module).toBe('@colinagent/dsh-mcp')
})

test('a bundle the gate skipped is degraded even though no Loader entry exists', () => {
  const composition = readComposition(fakeContext({
    entries: [entry('include:a', '@deepseek-ai/dsh-base', ACTIVE)],
    skips: [{ name: '@colinagent/dsh-mcp', reason: 'requires DSH 0.3.0' }],
  }))
  expect(composition.degraded).toEqual([
    { id: 'skipped:@colinagent/dsh-mcp', module: '@colinagent/dsh-mcp', version: 'unknown', state: 'skipped' },
  ])
})

test('the truncation bound never hides the suite or a failure', () => {
  const upstream = Array.from({ length: 200 }, (_value, index) => entry(`include:${String(index)}`, `@deepseek-ai/dsh-${String(index)}`, ACTIVE))
  const composition = readComposition(fakeContext({
    entries: [...upstream, entry('include:bot', '@colinagent/hulala-bot', ACTIVE)],
    skips: [{ name: '@colinagent/dsh-mcp', reason: 'requires DSH 0.3.0' }],
  }))
  expect(composition.plugins).toHaveLength(128)
  expect(composition.plugins.map(row => row.module)).toContain('@colinagent/hulala-bot')
  expect(composition.degraded.map(row => row.module)).toEqual(['@colinagent/dsh-mcp'])
})
