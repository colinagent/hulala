import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createPluginApi } from '../../src/tui/pluginApi.js'
import type { PluginManifest } from '../../src/plugins/manifest.js'

let dataRoot = ''

const manifest: PluginManifest = {
  id: 'fixture',
  name: 'hulala-plugin-fixture',
  version: '1.0.0',
  apiVersion: 1,
  entry: './index.js',
  directory: '/plugins/fixture',
}

interface Harness {
  ctx: Context
  notices: string[]
  errors: string[]
  registered: Array<{ seat: string; id: string; render(width: number): string[] }>
  commands: Array<{ name: string; description: string }>
  repaints: number
  requests: number
  /** Run every effect's disposer, as the context does when the window closes. */
  dispose(): void
}

/** A context with exactly the services the facade touches, and nothing else. */
const harness = (): Harness => {
  const notices: string[] = []
  const errors: string[] = []
  const registered: Harness['registered'] = []
  const commands: Harness['commands'] = []
  const disposers: Array<() => void> = []
  let repaints = 0
  let requests = 0
  const ctx = {
    hulalaLayout: {
      register: (seat: string, entry: { id: string; component: { render(width: number): string[] } }) => {
        registered.push({ seat, id: entry.id, render: (width: number) => entry.component.render(width) })
        return () => {
          const index = registered.findIndex(entry2 => entry2.id === entry.id)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
    hulalaRender: {
      request: () => { requests += 1 },
      repaint: () => { repaints += 1 },
      onSync: () => () => undefined,
    },
    hulalaSession: {
      id: 'session-1',
      cwd: '/workspace',
      model: { provider: 'deepseek', model: 'flash' },
      thinkingLevel: 'high',
      sessions: [{ sessionId: 'session-1', updatedAt: 1, running: true, blank: false, title: 'Fixture' }],
      disconnected: false,
    },
    hulalaCommands: {
      registerCommand: (name: string, description: string) => {
        commands.push({ name, description })
        return () => {
          const index = commands.findIndex(entry => entry.name === name)
          if (index >= 0) commands.splice(index, 1)
        }
      },
    },
    hulalaViewModel: {
      reducer: {
        busy: true,
        turnStartedAt: 42,
        metrics: { inputTokens: 10, outputTokens: 20, contextTokens: 30, contextLimit: 40 },
        addNotice: (text: string) => { notices.push(text) },
        addError: (text: string) => { errors.push(text) },
      },
    },
    effect: (run: () => (() => void) | void) => {
      const disposer = run()
      if (typeof disposer === 'function') disposers.push(disposer)
      return () => undefined
    },
  } as unknown as Context
  return {
    ctx,
    notices,
    errors,
    registered,
    commands,
    get repaints() { return repaints },
    get requests() { return requests },
    dispose: () => { for (const disposer of disposers.reverse()) disposer() },
  }
}

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'hulala-plugin-api-'))
})

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true })
})

describe('the plugin facade', () => {
  test('a seat is registered under its id and renders what the plugin returns', () => {
    const h = harness()
    const api = createPluginApi(h.ctx, manifest, dataRoot)
    api.seat('dock.status', { id: 'row' }, { render: (width: number) => [`w=${width}`] })
    expect(h.registered).toHaveLength(1)
    expect(h.registered[0]!.seat).toBe('dock.status')
    expect(h.registered[0]!.id).toBe('row')
    expect(h.registered[0]!.render(80)).toEqual(['w=80'])
  })

  test('a throwing render reports once and then degrades to one line', () => {
    const h = harness()
    const api = createPluginApi(h.ctx, manifest, dataRoot)
    api.seat('main', { id: 'boom' }, { render: () => { throw new Error('nope') } })
    // The whole point: pi-tui has no error boundary, so the facade must not throw.
    expect(() => h.registered[0]!.render(80)).not.toThrow()
    expect(h.registered[0]!.render(80)).toEqual(['⚠ plugin render failed'])
    expect(h.errors).toHaveLength(1)
    expect(h.errors[0]).toContain('plugin fixture: "boom" cannot render: nope')
    // A second frame must not report the same failure again.
    h.registered[0]!.render(80)
    expect(h.errors).toHaveLength(1)
  })

  test('a render that returns something other than strings is a failure, not a crash', () => {
    const h = harness()
    const api = createPluginApi(h.ctx, manifest, dataRoot)
    api.seat('main', { id: 'wrong' }, { render: (() => [1, 2]) as unknown as () => string[] })
    expect(h.registered[0]!.render(80)).toEqual(['⚠ plugin render failed'])
    expect(h.errors[0]).toContain('did not return string[]')
  })

  test('the marker is clamped, so a narrow terminal cannot be broken by it', () => {
    const h = harness()
    const api = createPluginApi(h.ctx, manifest, dataRoot)
    api.seat('main', { id: 'boom' }, { render: () => { throw new Error('x') } })
    expect(h.registered[0]!.render(5)).toEqual(['⚠ plu'])
  })

  test('removing a seat and disposing the plugin both unregister it', () => {
    const h = harness()
    const api = createPluginApi(h.ctx, manifest, dataRoot)
    const remove = api.seat('main', { id: 'a' }, { render: () => [] })
    api.seat('main', { id: 'b' }, { render: () => [] })
    remove()
    expect(h.registered.map(entry => entry.id)).toEqual(['b'])
    h.dispose()
    expect(h.registered).toEqual([])
  })

  test('commands, notices and errors reach the services behind them', () => {
    const h = harness()
    const api = createPluginApi(h.ctx, manifest, dataRoot)
    api.command('blame', 'Show git blame', () => undefined)
    api.notice('hello')
    api.error('bad')
    expect(h.commands).toEqual([{ name: 'blame', description: 'Show git blame' }])
    expect(h.notices).toEqual(['hello'])
    expect(h.errors).toEqual(['bad'])
    expect(h.repaints).toBe(2)
    h.dispose()
    expect(h.commands).toEqual([])
  })

  test('state maps the session facts onto the published snapshot', () => {
    const h = harness()
    const api = createPluginApi(h.ctx, manifest, dataRoot)
    expect(api.state()).toEqual({
      sessionId: 'session-1',
      cwd: '/workspace',
      model: { provider: 'deepseek', model: 'flash' },
      thinkingLevel: 'high',
      busy: true,
      turnStartedAt: 42,
      metrics: { inputTokens: 10, outputTokens: 20, contextTokens: 30, contextLimit: 40 },
      disconnected: false,
      sessions: [{ id: 'session-1', title: 'Fixture', running: true }],
    })
  })

  test('the plugin gets its own directory under the state root, created before activate', () => {
    const h = harness()
    const api = createPluginApi(h.ctx, manifest, dataRoot)
    expect(api.dataDir).toBe(join(dataRoot, 'runtime', 'plugins', 'fixture'))
    expect(api.apiVersion).toBe(1)
  })
})
