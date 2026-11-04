import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPlugin, listPlugins, newPlugin, togglePlugin } from '../../src/plugins/cli.js'
import { pluginsRoot, readPluginDirectory } from '../../src/plugins/directory.js'

let root = ''

/** Capture what a command wrote to stdout/stderr. */
const capture = async (run: () => number | Promise<number>): Promise<{ code: number, out: string, err: string }> => {
  const out: string[] = []
  const err: string[] = []
  const realOut = process.stdout.write.bind(process.stdout)
  const realErr = process.stderr.write.bind(process.stderr)
  process.stdout.write = ((chunk: string | Uint8Array) => { out.push(String(chunk)); return true }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => { err.push(String(chunk)); return true }) as typeof process.stderr.write
  try {
    const code = await run()
    return { code, out: out.join(''), err: err.join('') }
  } finally {
    process.stdout.write = realOut
    process.stderr.write = realErr
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hulala-plugin-cli-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('hulala plugin', () => {
  test('an empty directory lists nothing and says where to put one', async () => {
    const result = await capture(() => listPlugins(root))
    expect(result.code).toBe(0)
    expect(result.out).toContain('No TUI plugins')
    expect(result.out).toContain(pluginsRoot(root))
  })

  test('new writes a package that passes check unchanged', async () => {
    const created = await capture(() => newPlugin(root, 'hello'))
    expect(created.code).toBe(0)
    expect(readPluginDirectory(root).manifests.map(entry => entry.id)).toEqual(['hello'])

    const checked = await capture(() => checkPlugin(root, 'hello'))
    expect(checked.code).toBe(0)
    expect(checked.out).toContain('activate: ok')
    expect(checked.out).toContain('dock.status/hello-session')
    expect(checked.out).toContain('commands: hello')
    expect(checked.out).toContain('render: string[] at 20/80/200 columns')
    // The check must not claim more than it proved.
    expect(checked.out).toContain('not verified: layout, focus, key routing, live Host data')
  })

  test('new refuses an id that is not a slug, and refuses to overwrite', async () => {
    expect((await capture(() => newPlugin(root, 'Not A Slug'))).code).toBe(1)
    expect((await capture(() => newPlugin(root, 'hello'))).code).toBe(0)
    const again = await capture(() => newPlugin(root, 'hello'))
    expect(again.code).toBe(1)
    expect(again.err).toContain('already exists')
  })

  test('check gives up on a plugin that never settles, instead of hanging', async () => {
    await capture(() => newPlugin(root, 'slow'))
    writeFileSync(join(pluginsRoot(root), 'slow', 'index.js'), 'export function activate() { return new Promise(() => {}) }\n')
    // The client uses the same timeout, so a hung plugin cannot stop boot either.
    const result = await capture(() => checkPlugin(root, 'slow', 50))
    expect(result.code).toBe(1)
    expect(result.err).toContain('activate() did not finish within 50ms')
  })

  test('check reports a plugin whose entry exports no activate', async () => {
    await capture(() => newPlugin(root, 'silent'))
    writeFileSync(join(pluginsRoot(root), 'silent', 'index.js'), 'export const nothing = 1\n')
    const result = await capture(() => checkPlugin(root, 'silent'))
    expect(result.code).toBe(1)
    expect(result.err).toContain('exports no activate()')
  })

  test('check reports a render that returns something other than strings', async () => {
    await capture(() => newPlugin(root, 'wrong'))
    writeFileSync(join(pluginsRoot(root), 'wrong', 'index.js'), `export function activate(tui) {
  tui.seat('main', { id: 'bad' }, { render: () => [1, 2, 3] })
}
`)
    const result = await capture(() => checkPlugin(root, 'wrong'))
    expect(result.code).toBe(1)
    expect(result.err).toContain('did not return string[]')
  })

  test('check reports a render that throws, without failing the other seats', async () => {
    await capture(() => newPlugin(root, 'thrower'))
    writeFileSync(join(pluginsRoot(root), 'thrower', 'index.js'), `export function activate(tui) {
  tui.seat('main', { id: 'boom' }, { render: () => { throw new Error('nope') } })
  tui.seat('dock.status', { id: 'fine' }, { render: () => ['ok'] })
}
`)
    const result = await capture(() => checkPlugin(root, 'thrower'))
    expect(result.code).toBe(1)
    expect(result.err).toContain('main/boom threw at width 20: nope')
    expect(result.out).toContain('dock.status/fine')
  })

  test('check reports a missing entry file and an unknown id', async () => {
    await capture(() => newPlugin(root, 'gone'))
    rmSync(join(pluginsRoot(root), 'gone', 'index.js'), { force: true })
    expect((await capture(() => checkPlugin(root, 'gone'))).err).toContain('no entry file')
    expect((await capture(() => checkPlugin(root, 'absent'))).err).toContain('no plugin directory')
  })

  test('enable and disable record the state a second list reads back', async () => {
    await capture(() => newPlugin(root, 'hello'))
    expect((await capture(() => togglePlugin(root, 'hello', false))).code).toBe(0)
    expect((await capture(() => listPlugins(root))).out).toContain('disabled')
    expect((await capture(() => togglePlugin(root, 'hello', true))).out).toContain('enabled hello')
    expect((await capture(() => togglePlugin(root, 'absent', true))).code).toBe(1)
  })
})
