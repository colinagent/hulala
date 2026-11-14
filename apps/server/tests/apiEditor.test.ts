/**
 * The editor channel's request fence.
 *
 * The Host starts a real Neovim for whoever asks, so the request is validated
 * before any process exists: an absolute existing directory, a grid inside the
 * terminal column's limits, and a theme object. These tests pin the refusals.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEditorOpen } from '../src/plugins/apiEditor.ts'

const cwd = mkdtempSync(join(tmpdir(), 'hulala-editor-api-'))
const theme = { background: '#000000', foreground: '#ffffff', palette: ['#000000'] }

test('an absolute existing directory opens', () => {
  expect(parseEditorOpen({ kind: 'open', cwd, cols: 100, rows: 30, theme })).toEqual({
    kind: 'open',
    cwd,
    cols: 100,
    rows: 30,
    theme: theme as never,
  })
})

test('a relative path is refused, because the Host has no client directory', () => {
  expect(parseEditorOpen({ kind: 'open', cwd: 'workspace', cols: 100, rows: 30, theme })).toBeUndefined()
})

test('a missing directory is refused before any process starts', () => {
  expect(parseEditorOpen({ kind: 'open', cwd: join(cwd, 'gone'), cols: 100, rows: 30, theme })).toBeUndefined()
})

test('a grid outside the column limits is refused', () => {
  expect(parseEditorOpen({ kind: 'open', cwd, cols: 0, rows: 30, theme })).toBeUndefined()
  expect(parseEditorOpen({ kind: 'open', cwd, cols: 501, rows: 30, theme })).toBeUndefined()
  expect(parseEditorOpen({ kind: 'open', cwd, cols: 100, rows: 201, theme })).toBeUndefined()
  expect(parseEditorOpen({ kind: 'open', cwd, cols: 100.5, rows: 30, theme })).toBeUndefined()
})

test('a frame that is not an open request is refused', () => {
  expect(parseEditorOpen({ kind: 'resize' })).toBeUndefined()
  expect(parseEditorOpen(undefined)).toBeUndefined()
  expect(parseEditorOpen({ kind: 'open', cwd, cols: 100, rows: 30 })).toBeUndefined()
})

/** A socket the plugin can talk to, without a network. */
function fakeSocket(): {
  sent: Array<Record<string, unknown>>
  readyState: number
  OPEN: number
  send(value: string): void
  on(event: string, handler: (value?: unknown) => void): void
  close(): void
  emit(event: string, value?: unknown): void
} {
  const handlers = new Map<string, (value?: unknown) => void>()
  const state = {
    sent: [] as Array<Record<string, unknown>>,
    readyState: 1,
    OPEN: 1,
    send(value: string) { state.sent.push(JSON.parse(value) as Record<string, unknown>) },
    on(event: string, handler: (value?: unknown) => void) { handlers.set(event, handler) },
    close() { handlers.get('close')?.() },
    emit(event: string, value?: unknown) { handlers.get(event)?.(value) },
  }
  return state
}

test('a second connection with the same id attaches to the editor already running', async () => {
  const { serveOne } = await import('../src/plugins/apiEditor.ts')

  const spawned: string[] = []
  const child = Object.assign(new EventEmitter(), {
    pid: 1,
    exitCode: null,
    killed: false,
    stdin: { write: () => undefined },
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: () => { child.killed = true },
  })
  const home = {
    dataRoot: mkdtempSync(join(tmpdir(), 'hulala-home-')),
    dataHome: mkdtempSync(join(tmpdir(), 'hulala-data-')),
  }
  const live = new Map<string, never>()
  const options = {
    home: home as never,
    live: live as never,
    graceMs: 50,
    // The Host must not start a real Neovim for this: one fake child is enough
    // to show that the second connection reuses it.
    prepareEditor: () => ({ command: 'nvim', environment: {} }),
    spawnEditor: () => { spawned.push('started'); return child as never },
  }
  const open = { kind: 'open', id: 'editor-1', cwd, cols: 80, rows: 24, theme }
  const first = fakeSocket()
  serveOne({ ...options, socket: first as never })
  first.emit('message', Buffer.from(JSON.stringify(open)))
  expect(spawned).toHaveLength(1)
  expect(first.sent[0]).toEqual({ kind: 'ready', command: 'nvim' })

  // The socket drops and a second one arrives with the same id inside the grace
  // window: no second Neovim, and the client is told it resumed.
  first.close()
  const second = fakeSocket()
  serveOne({ ...options, socket: second as never })
  second.emit('message', Buffer.from(JSON.stringify(open)))
  expect(spawned).toHaveLength(1)
  expect(second.sent[0]).toEqual({ kind: 'ready', command: 'nvim', resumed: true })
})
