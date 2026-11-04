import { describe, expect, test } from 'bun:test'
import { isProblem, readManifest } from '../../src/plugins/manifest.js'

const ok = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'hulala-plugin-x',
  version: '1.2.3',
  ...extra,
  hulala: { tui: { apiVersion: 1, entry: './index.js', ...(extra.hulala === undefined ? {} : {}) } },
})

describe('the hulala.plugin manifest', () => {
  test('reads the declaration a plugin needs', () => {
    const read = readManifest('x', '/plugins/x', ok())
    expect(isProblem(read)).toBe(false)
    if (isProblem(read)) return
    expect(read.manifest).toEqual({
      id: 'x',
      name: 'hulala-plugin-x',
      version: '1.2.3',
      apiVersion: 1,
      entry: './index.js',
      directory: '/plugins/x',
    })
  })

  test('keeps a description when the package has one', () => {
    const read = readManifest('x', '/p', ok({ description: 'Draws a badge.' }))
    if (isProblem(read)) throw new Error(read.message)
    expect(read.manifest.description).toBe('Draws a badge.')
  })

  test('rejects a package with no hulala section', () => {
    const read = readManifest('x', '/p', { name: 'x', version: '1.0.0' })
    expect(isProblem(read) && read.message).toContain('declares no "hulala" section')
  })

  test('rejects a package whose hulala section has no tui half', () => {
    const read = readManifest('x', '/p', { name: 'x', hulala: { bundle: { patch: './cordis.patch.yml' } } })
    expect(isProblem(read) && read.message).toContain('"hulala.plugin"')
  })

  test('rejects an api version below the client minimum', () => {
    // `PLUGIN_MIN_API_VERSION` is 1 today; the guard exists so the first
    // removal is a one-line change instead of a silent break.
    const read = readManifest('x', '/p', { name: 'x', hulala: { tui: { apiVersion: 0.5, entry: './i.js' } } })
    expect(isProblem(read)).toBe(true)
  })

  test('rejects a newer api version with the numbers in the message', () => {
    const read = readManifest('x', '/p', { name: 'x', hulala: { tui: { apiVersion: 9, entry: './i.js' } } })
    expect(isProblem(read) && read.message).toBe('the plugin targets API 9; this client implements 1')
  })

  test('rejects an api version that is not a positive integer', () => {
    for (const apiVersion of [0, -1, 1.5, '1', undefined]) {
      const read = readManifest('x', '/p', { name: 'x', hulala: { tui: { apiVersion, entry: './i.js' } } })
      expect(isProblem(read)).toBe(true)
    }
  })

  test('rejects an entry that is bare, absolute or escapes the package', () => {
    for (const entry of ['index.js', '/etc/passwd', './../outside.js', '']) {
      const read = readManifest('x', '/p', { name: 'x', hulala: { tui: { apiVersion: 1, entry } } })
      expect(isProblem(read)).toBe(true)
    }
  })

  test('takes the directory name as identity when the package is unnamed', () => {
    const read = readManifest('fallback', '/p', { hulala: { tui: { apiVersion: 1, entry: './i.js' } } })
    if (isProblem(read)) throw new Error(read.message)
    expect(read.manifest.name).toBe('fallback')
    expect(read.manifest.version).toBe('0.0.0')
  })
})
