/**
 * A link in the conversation opens where the thing it names lives.
 *
 * The conversation's links come from the model, so activating one is the gesture
 * that has to cross the client/Host boundary correctly: a URL belongs to the
 * browser in front of the reader, and a file belongs to the Host — which may be
 * another machine, so the client may never resolve it itself. This is the
 * end-to-end contract, because the failure mode is silent: a link that renders
 * with an underline and a colour but opens nothing looks exactly like a link.
 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { resetCapabilitiesCache } from '@earendil-works/pi-tui'
import { runTerminalClient } from '../../src/tui/app.js'
import { GhosttyVt } from '../../src/tui/pane/ghosttyVt.js'
import { decodeMsgpack, type Msgpack } from '../../src/tui/editor/msgpack.js'
import type { EditorChannel } from '../../src/tui/data/editorChannel.js'
import type {
  HostEditor,
  TerminalBackend,
  TerminalSession,
  TerminalSessionHandlers,
} from '../../src/tui/data/remote.js'

const COLUMNS = 100
const ROWS = 30

/** The file the answer names, exactly as a model writes it: no scheme, no root. */
const FILE = '2026-11-24-trader-trade-memory.md'
/** What the link says, in the shape a model writes a reference in. */
const ANSWER = `I wrote it up: [${FILE}](${FILE}).`
const URL_ANSWER = 'See [the RFC](https://example.invalid/rfc) for the detail.'
const SESSION_CWD = '/workspace'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A Host that has already said these things, like a resumed Session. */
function stubBackend(
  events: never[],
  stat: (path: string) => Promise<{ absolutePath: string; version: string }>,
): TerminalBackend {
  return {
    host: { url: 'http://127.0.0.1:9', home: '/home/test' },
    async ready() {},
    async listSessions(): Promise<TerminalSession[]> {
      return [{ sessionId: 'session-1234', updatedAt: Date.now(), running: false, blank: false, cwd: SESSION_CWD }]
    },
    async searchSessions() { return { items: [], hasMore: false } },
    async ensureWorkspace() { return 'workspace-1' },
    async createSession() { return 'session-new' },
    follow(_sessionId: string, handlers: TerminalSessionHandlers) {
      queueMicrotask(() => {
        for (const event of events) handlers.onEvent(event)
      })
      return () => undefined
    },
    async prompt() {},
    async removeQueued() {},
    async cancel() {},
    async modelCatalog() { return { default: undefined, groups: [], failures: [] } },
    async selectModel() {},
    async permissionCatalog() { return { options: [], defaultOptions: [], defaultPreset: 'workspace-write' } },
    async setPermission() {},
    async commandCatalog() { return [] },
    async runCommand() { return undefined },
    async setDefaultPermission() {},
    async loginProviders() { return [] },
    async login() {},
    async rename() {},
    workspaceFiles: {
      stat: (_sessionId: string, path: string) => stat(path),
      async list() { return { path: '', absolutePath: '', entries: [] } },
      async read() { throw new Error('not used') },
    },
    onApproval() { return () => undefined },
    onQuestion() { return () => undefined },
    onSessionStatus() { return () => undefined },
    onSessionError() { return () => undefined },
    onSessionList() { return () => undefined },
    async close() {},
  } as unknown as TerminalBackend
}

/** One assistant answer, as the Host would replay it. */
function answer(text: string): never[] {
  return [
    {
      type: 'user/message',
      seq: 1,
      time: Date.now(),
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'write it up' }] },
    },
    {
      type: 'assistant/message',
      seq: 2,
      time: Date.now(),
      data: { message: { content: [{ type: 'text', text }] } },
    },
  ] as never[]
}

/** One client request, in Neovim's wire form: `[type, id, method, params]`. */
type Request = [number, number, string, Msgpack[]]

/** The Host's Neovim, recorded rather than started. */
function fakeEditor(): { face: HostEditor; requests: Request[]; spawned: () => boolean } {
  const requests: Request[] = []
  let spawned = false
  let exited: ((event: { code: number | null }) => void) | undefined
  const channel: EditorChannel = {
    async open() { spawned = true },
    onData() {},
    onProblem() {},
    onExit(handler) { exited = handler },
    onReconnect() {},
    onTree() {},
    send(chunk) {
      for (const value of decodeMsgpack(chunk).values) {
        if (!Array.isArray(value)) continue
        const request = value as Request
        requests.push(request)
        // The Host's Neovim is clean here, so `:qa` leaves at once; without this
        // the client would wait out its grace period on every quit.
        if (request[2] === 'nvim_input' && JSON.stringify(request[3]).includes(':qa')) {
          queueMicrotask(() => exited?.({ code: 0 }))
        }
      }
    },
    close() {},
  }
  return { face: { connect: () => channel }, requests, spawned: () => spawned }
}

/** Screen text with every SGR/OSC sequence removed. */
function plain(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu, '')
    .replace(/\u001b_pi:[^\u0007]*\u0007/gu, '')
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** One SGR pointer report, in the one-based coordinates a terminal sends. */
function pointer(code: number, column: number, row: number, final: 'M' | 'm'): string {
  return `\u001b[<${code};${column};${row}${final}`
}

/** A client attached to a Host that runs one editor, with its own frame buffer. */
async function startClient(options: {
  readonly events: never[]
  readonly stat: (path: string) => Promise<{ absolutePath: string; version: string }>
  readonly editor?: { face: HostEditor }
  readonly browse?: (url: string) => Promise<boolean>
  /** Whether the frame is drawn for a terminal that forwards OSC 8. */
  readonly hyperlinks?: boolean
  readonly name: string
}): Promise<{
  input: PassThrough
  plainRows: () => string[]
  run: Promise<number>
  stop: () => Promise<void>
}> {
  const previousLinks = process.env.PI_HYPERLINKS
  if (options.hyperlinks === true) {
    process.env.PI_HYPERLINKS = '1'
    resetCapabilitiesCache()
  }
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (_mode: boolean): void => undefined,
    setEncoding: (): void => undefined,
  })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: COLUMNS, rows: ROWS })
  const screen = new GhosttyVt(COLUMNS, ROWS)
  output.on('data', (chunk: Buffer | string) => { screen.write(new TextEncoder().encode(String(chunk))) })
  const home = mkdtempSync(join(tmpdir(), options.name))
  roots.push(home)
  const previousHome = process.env.HULALA_HOME
  process.env.HULALA_HOME = home
  const run = runTerminalClient({
    backend: {
      ...stubBackend(options.events, options.stat),
      ...(options.editor === undefined ? {} : { editor: options.editor.face }),
    },
    cwd: SESSION_CWD,
    input,
    output,
    resume: 'session-1234',
    // The suite's Escape arrives within 60 ms; production waits a tenth of a
    // second so a stalled frame can finish the sequence it belongs to.
    escapeTimeoutMs: 20,
    ...(options.browse === undefined ? {} : { browse: options.browse }),
  })
  return {
    input,
    plainRows: () => screen.renderRows(COLUMNS, ROWS, undefined, undefined).map(plain),
    run,
    stop: async () => {
      // A column holds the keyboard after a link opened: `Ctrl-F` is the way
      // back, so `/quit` reaches the composer instead of the far program.
      input.write('\u0006')
      await new Promise(resolve => setTimeout(resolve, 60))
      input.write('/quit\r')
      // A column that is still open is asked to leave before the window ends, so
      // the discard key settles the dialog when the fake Neovim did not answer.
      await new Promise(resolve => setTimeout(resolve, 120))
      input.write('d')
      await Promise.race([run, new Promise(resolve => setTimeout(resolve, 900))])
      input.destroy()
      output.destroy()
      if (previousHome === undefined) delete process.env.HULALA_HOME
      else process.env.HULALA_HOME = previousHome
      if (previousLinks === undefined) delete process.env.PI_HYPERLINKS
      else process.env.PI_HYPERLINKS = previousLinks
      resetCapabilitiesCache()
    },
  }
}

test('a clicked file is resolved by the Host and opened in its editor column', async () => {
  const asked: string[] = []
  const editor = fakeEditor()
  const client = await startClient({
    name: 'hulala-open-click-',
    events: answer(ANSWER),
    hyperlinks: true,
    editor,
    stat: async path => {
      asked.push(path)
      return { absolutePath: path, version: 'v1' }
    },
  })
  try {
    await waitFor(() => client.plainRows().some(line => line.includes(FILE)), 'the answer')
    const row = client.plainRows().findIndex(line => line.includes(FILE))
    const column = (client.plainRows()[row] ?? '').indexOf(FILE)
    expect(row).toBeGreaterThan(0)
    expect(column).toBeGreaterThan(0)

    // A press and a release on the same cell is a click, not a selection.
    client.input.write(pointer(0, column + 1, row + 1, 'M'))
    await new Promise(resolve => setTimeout(resolve, 40))
    client.input.write(pointer(0, column + 1, row + 1, 'm'))

    await waitFor(() => editor.spawned(), 'the editor column')
    // The Host was asked about one absolute path — the Session's directory with
    // the link's own name appended — and it is the *only* thing that decided the
    // file exists.
    await waitFor(() => asked.length === 1, 'the Host lookup')
    expect(asked[0]).toBe(`${SESSION_CWD}/${FILE}`)

    await waitFor(() => editor.requests.some(request => request[2] === 'nvim_exec_lua'), 'the file open')
    const open = editor.requests.find(request => request[2] === 'nvim_exec_lua')
    expect(open?.[3][1]).toEqual([`${SESSION_CWD}/${FILE}`])
  } finally {
    await client.stop()
  }
}, 20_000)

test('a clicked URL goes to the browser in front of the reader, never to the Host', async () => {
  const browsed: string[] = []
  const asked: string[] = []
  const client = await startClient({
    name: 'hulala-open-url-',
    events: answer(URL_ANSWER),
    hyperlinks: true,
    stat: async path => {
      asked.push(path)
      return { absolutePath: path, version: 'v1' }
    },
    browse: async url => {
      browsed.push(url)
      return true
    },
  })
  try {
    await waitFor(() => client.plainRows().some(line => line.includes('the RFC')), 'the answer')
    const row = client.plainRows().findIndex(line => line.includes('the RFC'))
    const column = (client.plainRows()[row] ?? '').indexOf('the RFC')
    expect(row).toBeGreaterThan(0)

    client.input.write(pointer(0, column + 1, row + 1, 'M'))
    await new Promise(resolve => setTimeout(resolve, 40))
    client.input.write(pointer(0, column + 1, row + 1, 'm'))

    await waitFor(() => browsed.length === 1, 'the browser launch')
    expect(browsed[0]).toBe('https://example.invalid/rfc')
    // A URL is location-independent, so the Host is never asked about it — over
    // SSH that question would be about a file the far machine does not have.
    expect(asked).toEqual([])
  } finally {
    await client.stop()
  }
}, 20_000)
