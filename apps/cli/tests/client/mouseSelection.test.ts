/**
 * Dragging text in the conversation selects and copies it; clicking a step row
 * header folds it.
 *
 * The two share one gesture space: the alternate screen draws the selection, the
 * transcript only answers a completed click, and a drag that starts on a header
 * line must stay a selection. This is the end-to-end contract — real client,
 * real layout, real key handling — because a component that claims the press
 * silently breaks the other half, which is exactly how it went wrong before.
 */
import { expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import { runTerminalClient } from '../../src/tui/app.js'
import { GhosttyVt } from '../../src/tui/pane/ghosttyVt.js'
import type { TerminalBackend, TerminalSession, TerminalSessionHandlers } from '../../src/tui/data/remote.js'

const COLUMNS = 100
const ROWS = 30
const ANSWER = 'I reinstalled the dependencies and the build passes now.'

/** A Host that has already said these things, like a resumed Session. */
function stubBackend(): TerminalBackend {
  const events = [
    {
      type: 'user/message',
      seq: 1,
      time: Date.now(),
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'please fix the build' }] },
    },
    {
      type: 'tool/call',
      seq: 2,
      time: Date.now(),
      data: { callId: 'call-1', name: 'bash', arguments: JSON.stringify({ command: 'bun install', description: 'Install deps' }) },
    },
    {
      type: 'tool/result',
      seq: 3,
      time: Date.now(),
      data: { callId: 'call-1', result: 'installed 42 packages', status: 'ok' },
    },
    {
      type: 'assistant/message',
      seq: 4,
      time: Date.now(),
      data: { message: { content: [{ type: 'text', text: ANSWER }] } },
    },
  ] as never[]
  return {
    host: { url: 'http://127.0.0.1:9', home: '/home/test' },
    async ready() {},
    async listSessions(): Promise<TerminalSession[]> {
      return [{ sessionId: 'session-1234', updatedAt: Date.now(), running: false, blank: false, cwd: '/workspace' }]
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
    onApproval() { return () => undefined },
    onQuestion() { return () => undefined },
    onSessionStatus() { return () => undefined },
    onSessionError() { return () => undefined },
    onSessionList() { return () => undefined },
    async close() {},
  } as unknown as TerminalBackend
}

/** Screen text with every SGR/OSC sequence removed. */
function plain(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '')
    .replace(/\u001b\][^\u0007\u001b]*\u0007/gu, '')
    .replace(/\u001b_pi:[^\u0007]*\u0007/gu, '')
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const pause = async (ms = 60): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, ms))
}

/** One SGR pointer report, in the one-based coordinates a terminal sends. */
function pointer(code: number, column: number, row: number, final: 'M' | 'm'): string {
  return `\u001b[<${code};${column};${row}${final}`
}

test('a drag across an answer selects it, copies it, and a click still folds a step row', async () => {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (_mode: boolean): void => undefined,
    setEncoding: (): void => undefined,
  })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: COLUMNS, rows: ROWS })
  const screen = new GhosttyVt(COLUMNS, ROWS)
  output.on('data', (chunk: Buffer | string) => { screen.write(new TextEncoder().encode(String(chunk))) })
  const copied: string[] = []
  const run = runTerminalClient({
    backend: stubBackend(),
    cwd: '/workspace',
    input,
    output,
    resume: 'session-1234',
    copySelection: async text => {
      copied.push(text)
      return true
    },
  })
  const rows = (): string[] => screen.renderRows(COLUMNS, ROWS, undefined, undefined)
  const plainRows = (): string[] => rows().map(plain)

  try {
    await waitFor(() => plainRows().some(line => line.includes(ANSWER)), 'the answer')

    // The conversation column starts to the right of the Session rail.
    const answerRow = plainRows().findIndex(line => line.includes(ANSWER))
    const answerColumn = (plainRows()[answerRow] ?? '').indexOf(ANSWER)
    expect(answerRow).toBeGreaterThan(0)
    expect(answerColumn).toBeGreaterThan(0)

    // Press on the first word, drag past the end of the line, release.
    input.write(pointer(0, answerColumn + 1, answerRow + 1, 'M'))
    await pause()
    input.write(pointer(32, COLUMNS - 2, answerRow + 1, 'M'))
    await pause()
    input.write(pointer(0, COLUMNS - 2, answerRow + 1, 'm'))
    await waitFor(() => copied.length === 1, 'the copied selection')

    // The selection is the answer and nothing else: no gutter, no padding.
    expect(copied[0]?.trim()).toBe(ANSWER)
    // And it stays visible on screen, which is what a reader expects to see.
    expect(rows()[answerRow]).toMatch(/\u001b\[7[;m]/u)

    // A drag that starts on a step row's header line is a selection too. The
    // header is a click target, and taking the press for it used to swallow the
    // whole gesture: no highlight, no fold, nothing.
    const headerRow = plainRows().findIndex(line => line.includes('Bash · Install deps'))
    expect(headerRow).toBeGreaterThan(0)
    const headerText = (plainRows()[headerRow] ?? '').slice((plainRows()[headerRow] ?? '').indexOf('Bash')).trimEnd()
    const headerColumn = (plainRows()[headerRow] ?? '').indexOf('Bash')
    input.write(pointer(0, headerColumn + 1, headerRow + 1, 'M'))
    await pause()
    input.write(pointer(32, COLUMNS - 2, headerRow + 1, 'M'))
    await pause()
    input.write(pointer(0, COLUMNS - 2, headerRow + 1, 'm'))
    await waitFor(() => copied.length === 2, 'the copied header line')
    expect(copied[1]?.trim()).toBe(headerText)

    // A click on the tool row header still folds that row. It is a separate
    // gesture: the press is not claimed, and the release arrives as a click.
    await pause(600)
    input.write(pointer(0, headerColumn + 1, headerRow + 1, 'M'))
    await pause()
    input.write(pointer(0, headerColumn + 1, headerRow + 1, 'm'))
    await waitFor(() => plainRows()[headerRow]?.includes('▾') === true, 'the folded row')

    // The click was not a selection, so it copied nothing again.
    expect(copied).toHaveLength(2)
  } finally {
    input.write('/quit\r')
    await run
  }
})

test('over SSH the selection reaches the terminal clipboard as OSC 52', async () => {
  const previous = process.env.SSH_CONNECTION
  process.env.SSH_CONNECTION = '10.0.0.2 51000 10.0.0.1 22'
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (_mode: boolean): void => undefined,
    setEncoding: (): void => undefined,
  })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: COLUMNS, rows: ROWS })
  const screen = new GhosttyVt(COLUMNS, ROWS)
  let bytes = ''
  output.on('data', (chunk: Buffer | string) => {
    bytes += String(chunk)
    screen.write(new TextEncoder().encode(String(chunk)))
  })
  // No injected copySelection: the client's own routing runs, and a remote
  // session must write the terminal's clipboard rather than starting a writer
  // on the machine the user is not sitting at.
  const run = runTerminalClient({ backend: stubBackend(), cwd: '/workspace', input, output, resume: 'session-1234' })
  const plainRows = (): string[] => screen.renderRows(COLUMNS, ROWS, undefined, undefined).map(plain)
  try {
    await waitFor(() => plainRows().some(line => line.includes(ANSWER)), 'the answer')
    const answerRow = plainRows().findIndex(line => line.includes(ANSWER))
    const answerColumn = (plainRows()[answerRow] ?? '').indexOf(ANSWER)
    input.write(pointer(0, answerColumn + 1, answerRow + 1, 'M'))
    await pause()
    input.write(pointer(32, COLUMNS - 2, answerRow + 1, 'M'))
    await pause()
    input.write(pointer(0, COLUMNS - 2, answerRow + 1, 'm'))
    const expected = `\u001b]52;c;${Buffer.from(ANSWER).toString('base64')}\u0007`
    await waitFor(() => bytes.includes(expected), 'the OSC 52 clipboard write')
  } finally {
    input.write('/quit\r')
    await run
    if (previous === undefined) delete process.env.SSH_CONNECTION
    else process.env.SSH_CONNECTION = previous
  }
})
