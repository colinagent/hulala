import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  pluginsRoot,
  pruneState,
  readDisabled,
  readPluginDirectory,
  setEnabled,
} from '../../src/plugins/directory.js'

let root = ''

const plugin = (id: string, manifest: unknown): void => {
  const directory = join(pluginsRoot(root), id)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hulala-plugins-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the plugin directory', () => {
  test('an absent root is an empty directory, not an error', () => {
    const directory = readPluginDirectory(root)
    expect(directory.manifests).toEqual([])
    expect(directory.problems).toEqual([])
    expect([...directory.disabled]).toEqual([])
  })

  test('reads every loadable package and reports the rest', () => {
    plugin('good', { name: 'good', version: '1.0.0', hulala: { tui: { apiVersion: 1, entry: './i.js' } } })
    plugin('newer', { name: 'newer', version: '1.0.0', hulala: { tui: { apiVersion: 5, entry: './i.js' } } })
    const directory = readPluginDirectory(root)
    expect(directory.manifests.map(entry => entry.id)).toEqual(['good'])
    expect(directory.problems.map(entry => entry.id)).toEqual(['newer'])
  })

  test('a directory without a package.json is ignored rather than reported', () => {
    mkdirSync(join(pluginsRoot(root), 'half-copied'), { recursive: true })
    const directory = readPluginDirectory(root)
    expect(directory.manifests).toEqual([])
    expect(directory.problems).toEqual([])
  })

  test('one broken package does not hide the others', () => {
    plugin('broken', { hulala: 'nonsense' })
    plugin('fine', { name: 'fine', hulala: { tui: { apiVersion: 1, entry: './i.js' } } })
    const directory = readPluginDirectory(root)
    expect(directory.manifests.map(entry => entry.id)).toEqual(['fine'])
    expect(directory.problems.map(entry => entry.id)).toEqual(['broken'])
  })

  test('records enablement beside the directory, not inside a package', () => {
    plugin('a', { name: 'a', hulala: { tui: { apiVersion: 1, entry: './i.js' } } })
    setEnabled(root, 'a', false)
    expect([...readDisabled(root)]).toEqual(['a'])
    expect(readPluginDirectory(root).disabled.has('a')).toBe(true)
    // The package itself stays untouched, so reinstalling it from a checkout
    // cannot silently re-enable something the user switched off.
    expect(readFileSync(join(pluginsRoot(root), 'a', 'package.json'), 'utf8')).not.toContain('disabled')

    setEnabled(root, 'a', true)
    expect([...readDisabled(root)]).toEqual([])
  })

  test('a corrupt record reads as everything enabled', () => {
    mkdirSync(join(root, 'config', 'tui'), { recursive: true })
    writeFileSync(join(root, 'config', 'tui', 'plugins.json'), '{not json')
    expect([...readDisabled(root)]).toEqual([])
  })

  test('forgets plugins that are no longer installed', () => {
    plugin('kept', { name: 'kept', hulala: { tui: { apiVersion: 1, entry: './i.js' } } })
    setEnabled(root, 'kept', false)
    setEnabled(root, 'gone', false)
    pruneState(root, new Set(['kept']))
    expect([...readDisabled(root)]).toEqual(['kept'])
    expect(readPluginDirectory(root).manifests.map(entry => entry.id)).toEqual(['kept'])
  })
})
