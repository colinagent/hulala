import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { runTerminalClient } from '../../src/tui/app.js'
import type { PtyModule } from '../../src/tui/editor/pty.js'
import type {
  SessionListEvent,
  TerminalApproval,
  TerminalApprovalOutcome,
  TerminalBackend,
  TerminalInbox,
  TerminalPromptMode,
  TerminalQuestion,
  TerminalQuestionAnswer,
  TerminalSession,
  TerminalSessionHandlers,
} from '../../src/tui/data/remote.js'

interface FakeBackend {
  backend: TerminalBackend
  prompts: string[]
  /** Delivery mode of each recorded prompt, in call order. */
  modes: TerminalPromptMode[]
  /** Inbox ids the client asked the Host to drop. */
  removes: string[]
  cancels: string[]
  /** Provider logins recorded by the fake Host. */
  logins: Array<{ providerId: string; apiKey: string }>
  /** Model selections in `provider/model` form. */
  models: string[]
  /** Directories a new Session was requested in. */
  workspaces: string[]
  /** Session ids the fake Host created. */
  created: string[]
  /** Session ids the client attached its follow stream to, in call order. */
  followed: string[]
  /** How many times the Session list was fetched (the picker fetches it again). */
  listSessionsCalls(): number
  handlers: TerminalSessionHandlers | undefined
  approve(request: TerminalApproval): Promise<TerminalApprovalOutcome>
  ask(questions: readonly TerminalQuestion[]): Promise<{ answers: TerminalQuestionAnswer[] } | undefined>
  /** Publish both pending lists the way the Host's `inbox` projection does. */
  inbox(inbox: TerminalInbox): void
  /** Publish one Host Session-list event. */
  listEvent(event: SessionListEvent): void
  /** Sessions the fake Host hands out from `listSessions`. */
  setSessions(sessions: TerminalSession[]): void
}

function fakeBackend(sessionCwd = '/workspace'): FakeBackend {
  const prompts: string[] = []
  const modes: TerminalPromptMode[] = []
  const removes: string[] = []
  const cancels: string[] = []
  const logins: Array<{ providerId: string; apiKey: string }> = []
  const models: string[] = []
  /** Directories `ensureWorkspace` was asked for, in call order. */
  const workspaces: string[] = []
  /** Session ids the fake Host handed out. */
  const created: string[] = []
  const followed: string[] = []
  let listSessionsCalls = 0
  let approval: ((request: TerminalApproval) => Promise<TerminalApprovalOutcome>) | undefined
  let question: ((questions: readonly TerminalQuestion[], signal?: AbortSignal) => Promise<{ answers: TerminalQuestionAnswer[] } | undefined>) | undefined
  let liveHandlers: TerminalSessionHandlers | undefined
  let sessionList: ((event: SessionListEvent) => void) | undefined
  let hostSessions: TerminalSession[] = []
  const backend: TerminalBackend = {
    host: { url: 'http://127.0.0.1:9', home: '/home/test' },
    async ready() {},
    async listSessions() {
      listSessionsCalls += 1
      return hostSessions.length === 0
        ? [{ sessionId: 'session-1234', updatedAt: Date.now(), running: false, blank: false, cwd: sessionCwd }]
        : [...hostSessions]
    },
    async searchSessions() { return { items: [], hasMore: false } },
    async ensureWorkspace(path) { workspaces.push(path); return 'workspace-1' },
    async createSession() { created.push('session-new'); return 'session-new' },
    follow(sessionId, handlers) {
      followed.push(sessionId)
      liveHandlers = handlers
      queueMicrotask(() => {
        handlers.onEvent({
          type: 'user/message', seq: 1, time: Date.now(),
          data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'history question' }] },
        })
        handlers.onEvent({
          type: 'assistant/message', seq: 2, time: Date.now(),
          data: { message: { content: [{ type: 'text', text: 'history answer' }] } },
        })
      })
      return () => { liveHandlers = undefined }
    },
    async prompt(_sessionId, text, mode) {
      prompts.push(text)
      modes.push(mode)
    },
    async removeQueued(_sessionId, itemId) { removes.push(itemId) },
    async cancel(sessionId) { cancels.push(sessionId) },
    async modelCatalog() {
      return {
        default: { provider: 'test', model: 'test-model' },
        groups: [{
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [{
            id: 'deepseek-flash',
            name: 'DeepSeek-V4.1-Flash',
            reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }], defaultEffort: 'off' },
          }],
        }],
        failures: [],
      }
    },
    async selectModel(_sessionId, selection) { models.push(`${selection.provider}/${selection.model}`) },
    async loginProviders() {
      return [
        { id: 'deepseek-official', name: 'DeepSeek', active: false, configured: false, baseURL: 'https://api.deepseek.com' },
        { id: 'anthropic', name: 'anthropic', active: true, configured: true, source: 'file' },
      ]
    },
    async login(providerId, apiKey) { logins.push({ providerId, apiKey }) },
    async rename() {},
    onApproval(handler) { approval = handler; return () => { approval = undefined } },
    onQuestion(handler) { question = handler; return () => { question = undefined } },
    onSessionStatus() { return () => undefined },
    onSessionError() { return () => undefined },
    onSessionList(handler) { sessionList = handler; return () => { sessionList = undefined } },
    async close() {},
  }
  return {
    backend,
    prompts,
    modes,
    removes,
    cancels,
    logins,
    models,
    workspaces,
    created,
    followed,
    listSessionsCalls: () => listSessionsCalls,
    get handlers() { return liveHandlers },
    approve: request => {
      if (approval === undefined) throw new Error('approval handler is not subscribed')
      return approval(request)
    },
    ask: questions => {
      if (question === undefined) throw new Error('question handler is not subscribed')
      return question(questions)
    },
    inbox: inbox => {
      if (liveHandlers === undefined) throw new Error('follow handler is not subscribed')
      liveHandlers.onInbox?.(inbox)
    },
    listEvent: event => {
      if (sessionList === undefined) throw new Error('session list handler is not subscribed')
      sessionList(event)
    },
    setSessions: sessions => { hostSessions = [...sessions] },
  }
}

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/** Terminal output without the SGR/OSC framing pi-tui paints around every cell. */
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

test('non-TTY mode prints history and forwards prompts line by line', async () => {
  const fake = fakeBackend()
  const input = new PassThrough()
  const output = new PassThrough()
  let text = ''
  output.on('data', chunk => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
  await waitFor(() => text.includes('history answer'), 'history')
  expect(text).toContain('Session session-1234')
  expect(text).toContain('› history question')
  input.write('next question\n')
  await waitFor(() => fake.prompts.includes('next question'), 'prompt')
  input.write('/quit\n')
  await expect(run).resolves.toBe(0)
  expect(fake.prompts).toEqual(['next question'])
})

test('TTY mode draws the pi-tui editor borders and keeps them after submit', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 40 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
  await waitFor(() => (text.match(/─/gu) ?? []).length >= 2, 'editor borders')
  input.write('hello\r')
  await waitFor(() => fake.prompts.includes('hello'), 'prompt')
  await waitFor(() => (text.match(/─/gu) ?? []).length >= 2, 'borders after submit')
  expect(fake.prompts).toContain('hello')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('TTY mode shows the running indicator while the turn is live', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  fake.handlers?.onRunning(true)
  await waitFor(() => text.includes('Deep diving for'), 'running indicator')
  expect(text).toContain('Deep diving for 1s')
  fake.handlers?.onRunning(false)
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('TTY mode announces a newer release and keeps the hint in the status bar', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({
    backend: fake.backend,
    cwd: '/workspace',
    input,
    output,
    resume: 'session-1234',
    updateCheck: async () => ({ currentVersion: '0.1.8', latestVersion: '9.9.9' }),
  })
  await waitFor(() => text.includes('Update available'), 'update notice')
  expect(text).toContain('0.1.8 → 9.9.9')
  expect(text).toContain('hulala update')
  expect(text).toContain('update 9.9.9')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('TTY mode cancels the running turn on Escape', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  fake.handlers?.onRunning(true)
  await waitFor(() => text.includes('Deep diving for'), 'running indicator')
  input.write('\u001b') // Escape: pi's interrupt key
  await waitFor(() => fake.cancels.length === 1, 'cancel request')
  expect(fake.cancels).toEqual(['session-1234'])
  input.write('\u001b') // a repeat or a second press must not ask again
  await new Promise(resolve => setTimeout(resolve, 60))
  expect(fake.cancels).toEqual(['session-1234'])
  // The Host is what settles the turn; the composer stays idle meanwhile.
  fake.handlers?.onEvent({ type: 'turn/end', seq: 3, time: Date.now(), data: { reason: { kind: 'aborted' } } })
  await waitFor(() => text.includes('Turn cancelled'), 'cancelled turn')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('TTY mode lets an open completion menu close on Escape before it cancels', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  fake.handlers?.onRunning(true)
  await waitFor(() => text.includes('Deep diving for'), 'running indicator')
  input.write('/')
  await new Promise(resolve => setTimeout(resolve, 40))
  input.write('\u001b') // closes the menu, as in pi
  await new Promise(resolve => setTimeout(resolve, 40))
  expect(fake.cancels).toEqual([])
  input.write('\u0003') // Ctrl-C with text in the composer clears it, it does not cancel
  await new Promise(resolve => setTimeout(resolve, 40))
  input.write('\u001b') // nothing left open: this one interrupts
  await waitFor(() => fake.cancels.length === 1, 'cancel request')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('TTY mode moves Escape onto the rail, and the picker returns once the rail is put away', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/launch', input, output, resume: 'session-1234' })
  await waitFor(() => text.includes('history answer'), 'transcript')
  const listedBefore = fake.listSessionsCalls()
  // On an idle empty composer Escape is the leftward move into the rail.
  input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(fake.listSessionsCalls()).toBe(listedBefore)
  expect(fake.cancels).toEqual([])
  // The keyboard is on the rail: `n` creates a Session in the open directory.
  input.write('n')
  await waitFor(() => fake.created.length === 1, 'new Session')
  // The new Session lands in the open Session's directory, not the launch one.
  expect(fake.workspaces).toEqual(['/workspace'])
  // Ctrl-G first focuses the visible rail, then puts it away; the double-Esc
  // picker is the fallback once it is gone.
  input.write('\u0007')
  await new Promise(resolve => setTimeout(resolve, 80))
  input.write('\u0007')
  await new Promise(resolve => setTimeout(resolve, 80))
  input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 40))
  input.write('\u001b')
  await waitFor(() => text.includes('Resume Session'), 'Session picker')
  expect(fake.listSessionsCalls()).toBeGreaterThan(listedBefore)
  input.write('\u001b') // Escape closes the picker like any other choice-less modal
  await new Promise(resolve => setTimeout(resolve, 100))
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('Ctrl-[ then Ctrl-N and Enter switches to the next Session in the rail', async () => {
  const fake = fakeBackend()
  fake.setSessions([
    { sessionId: 'session-1234', updatedAt: Date.now(), running: false, blank: false, cwd: '/workspace', title: 'current one' },
    { sessionId: 'session-9999', updatedAt: Date.now() - 60_000, running: false, blank: false, cwd: '/workspace', title: 'older one' },
  ])
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
  await waitFor(() => plain(text).includes('older one'), 'rail rows')
  input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 120))
  input.write('\u000e') // Ctrl-N
  await new Promise(resolve => setTimeout(resolve, 80))
  input.write('\r')
  await waitFor(() => fake.followed.includes('session-9999'), 'Session switch')
  expect(fake.followed.at(-1)).toBe('session-9999')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('Ctrl-G moves the keyboard into a visible rail, and again puts it away', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
  await waitFor(() => plain(text).includes('+ 新会话'), 'rail')
  // The rail is visible but the composer has the keyboard; Ctrl-G focuses it,
  // which `n` proves by creating a Session.
  input.write('\u0007')
  await new Promise(resolve => setTimeout(resolve, 120))
  input.write('n')
  await waitFor(() => fake.created.length === 1, 'new Session')
  // Creating a Session handed the keyboard back to the composer; Ctrl-G then
  // focuses the visible rail again, and one more press puts it away.
  input.write('\u0007')
  await new Promise(resolve => setTimeout(resolve, 120))
  input.write('\u0007')
  await new Promise(resolve => setTimeout(resolve, 120))
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('a composer draft survives moving into the rail and back', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
  await waitFor(() => plain(text).includes('history answer'), 'transcript')
  input.write('draft text')
  await new Promise(resolve => setTimeout(resolve, 60))
  // Esc still moves the keyboard even with a draft: the composer is not cleared.
  input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 120))
  input.write('/')
  input.write('q')
  await waitFor(() => plain(text).includes('> q'), 'rail filter')
  // Esc clears the filter, Esc again leaves the rail; the draft is still there.
  input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 80))
  input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 80))
  input.write('\r')
  await waitFor(() => fake.prompts.includes('draft text'), 'draft submit')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('Ctrl-[ moves onto the rail before the first Session has opened', async () => {
  const fake = fakeBackend()
  const listSessions = fake.backend.listSessions.bind(fake.backend)
  // A slow list is the window in which `sessionId` is still unset: the rail is
  // already painted, so the leftward move has to work there too.
  fake.backend.listSessions = async () => {
    await new Promise(resolve => setTimeout(resolve, 800))
    return await listSessions()
  }
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
  await waitFor(() => plain(text).includes('+ 新会话'), 'rail')
  input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 120))
  input.write('/')
  input.write('zz')
  await waitFor(() => plain(text).includes('> zz'), 'rail filter')
  // The rail owns the keyboard, so the composer never received the query.
  expect(fake.prompts).toEqual([])
  input.write('\u0003')
  await new Promise(resolve => setTimeout(resolve, 100))
  input.write('\u0003')
  await expect(run).resolves.toBe(0)
})

test('the rail shows the open directory, its Sessions and a background turn spinner', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 24 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
  await waitFor(() => text.includes('history answer'), 'transcript')
  await waitFor(() => plain(text).includes('+ 新会话'), 'rail rows')
  expect(plain(text)).toContain('/workspace')
  expect(plain(text)).toContain('search')
  expect(plain(text)).toContain('all')
  // A turn started elsewhere reaches the rail through the Host list event.
  fake.listEvent({
    kind: 'added',
    session: { sessionId: 'session-9999', updatedAt: Date.now(), running: true, blank: false, cwd: '/workspace', title: 'bg run' },
  })
  await waitFor(() => text.includes('bg run'), 'background row')
  await waitFor(() => /[\u2800-\u28ff]/u.test(text), 'running spinner')
  // Another directory stays out of the folded list.
  fake.listEvent({
    kind: 'added',
    session: { sessionId: 'session-7777', updatedAt: Date.now(), running: false, blank: false, cwd: '/elsewhere', title: 'other dir' },
  })
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(plain(text)).not.toContain('other dir')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('a Session the rail started blank takes its title from the journal', async () => {
  const fake = fakeBackend()
  // A Session created by `+ 新会话` carries the blank flag until the Host lists
  // it again, and the Host never sends a second summary for that transition.
  fake.setSessions([{ sessionId: 'session-1234', updatedAt: Date.now(), running: false, blank: true, cwd: '/workspace' }])
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 24 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
  await waitFor(() => plain(text).includes('新会话'), 'blank rail row')
  fake.handlers?.onEvent({ type: 'user/message', seq: 3, time: Date.now(), data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } })
  fake.handlers?.onEvent({ type: 'session/title', seq: 4, time: Date.now(), data: { title: 'X Bio', source: { kind: 'fallback' } } })
  await waitFor(() => plain(text).includes('X Bio'), 'rail title')
  // A summary the Host published before the first prompt arrives late; it must
  // neither clear the title nor put the row back behind `新会话`.
  fake.listEvent({ kind: 'added', session: { sessionId: 'session-1234', updatedAt: Date.now(), running: false, blank: true, cwd: '/workspace' } })
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(plain(text)).toContain('X Bio')
  // A prompt sent from another client arrives only as activity: it dates the
  // row and proves the Session is no longer blank, without a second summary.
  fake.listEvent({ kind: 'added', session: { sessionId: 'session-9999', updatedAt: Date.now() - 60_000, running: false, blank: true, cwd: '/workspace' } })
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(plain(text)).not.toContain('sess…9999')
  fake.listEvent({ kind: 'activity', sessionId: 'session-9999', updatedAt: Date.now() })
  await waitFor(() => plain(text).includes('sess…9999'), 'engaged background row')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('TTY mode opens the editor column with Ctrl-T and reports why it cannot', async () => {
  // A directory that does not exist: the column reports why it cannot start,
  // which proves the key chose the editor without spawning a process.
  const fake = fakeBackend('/hulala-missing-column-dir')
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/hulala-missing-column-dir', input, output, resume: 'session-1234' })
  await waitFor(() => text.includes('history answer'), 'transcript')
  input.write('\u0014') // Ctrl-T
  await waitFor(() => text.includes('editor unavailable'), 'editor column')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('TTY mode leaves Ctrl-T to an open overlay', async () => {
  const fake = fakeBackend('/hulala-missing-column-dir')
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/hulala-missing-column-dir', input, output, resume: 'session-1234' })
  await waitFor(() => text.includes('history answer'), 'transcript')
  input.write('/help\r')
  await waitFor(() => text.includes('任意键关闭'), 'help overlay')
  input.write('\u0014') // Ctrl-T closes the overlay instead of opening the editor
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(text).not.toContain('editor unavailable')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('TTY mode keeps the editor column open across focus changes and hands nvim its keys', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-sidebar-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startEditorTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write('\u0014') // Ctrl-T opens the editor column with the keyboard in it
  await waitFor(() => editor.spawned(), 'editor column')
  // The composer lost focus: its cursor stays visible as a half-opacity block
  // (or the hollow glyph when the test environment has colour off).
  await waitFor(() => /\u001b\[48;[25];/.test(tty.painted()) || tty.painted().includes('□'), 'dim composer cursor')

  // Ctrl-W and Ctrl-F are Neovim's again: the window prefix and page-down reach
  // it instead of closing the column or being swallowed.
  tty.input.write('\u0017')
  tty.input.write('\u0006')
  await waitFor(() => editor.writes().includes('\u0017') && editor.writes().includes('\u0006'), 'nvim gets Ctrl-W and Ctrl-F')

  tty.input.write('\u001b') // normal mode: Ctrl-[ leaves to the composer, column stays
  await new Promise(resolve => setTimeout(resolve, 60))
  tty.input.write('from-composer\r')
  await waitFor(() => fake.prompts.includes('from-composer'), 'the composer has the keyboard')

  tty.input.write('\u001d') // Ctrl-]: back into the editor without restarting it
  tty.input.write('back-in-nvim')
  await waitFor(() => editor.writes().includes('back-in-nvim'), 'keys return to nvim')

  tty.input.write('\u0014') // Ctrl-T closes: Neovim is clean, so it leaves at once
  await new Promise(resolve => setTimeout(resolve, 200))
  tty.input.write('\u0004') // and the client quits
  await expect(tty.run).resolves.toBe(0)
})

/** A TTY client on a fake Host, with the bytes it painted collected. */
function startTty(fake: FakeBackend, columns = 100): {
  input: PassThrough & { isTTY: true; setRawMode(mode: boolean): void; setEncoding(): void }
  output: PassThrough & { isTTY: true; columns: number }
  painted(): string
  run: Promise<number>
} {
  const input = Object.assign(new PassThrough(), {
    isTTY: true as const,
    setRawMode: (_mode: boolean): void => undefined,
    setEncoding: (): void => undefined,
  })
  const output = Object.assign(new PassThrough(), { isTTY: true as const, columns })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
  // Detach even when an assertion threw, so a failure cannot leave the client's
  // repaint timer keeping the test process alive.
  cleanups.push(async () => {
    input.write('/quit\r')
    await Promise.race([run, new Promise(resolve => setTimeout(resolve, 500))])
    input.destroy()
    output.destroy()
  })
  return { input, output, painted: () => text, run }
}

test('TTY mode steers a running turn on Enter and queues on Alt-Enter', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  // Idle: Enter and Alt-Enter are the same gesture.
  tty.input.write('idle question\r')
  await waitFor(() => fake.prompts.length === 1, 'idle prompt')
  tty.input.write('idle follow-up\u001b\r')
  await waitFor(() => fake.prompts.length === 2, 'idle follow-up')
  expect(fake.modes).toEqual(['queue', 'queue'])
  // Running: Enter interjects, Alt-Enter queues the next turn.
  fake.handlers?.onRunning(true)
  await waitFor(() => tty.painted().includes('Deep diving for'), 'running indicator')
  tty.input.write('change of plan\r')
  await waitFor(() => fake.prompts.length === 3, 'steer')
  tty.input.write('later, please\u001b\r')
  await waitFor(() => fake.prompts.length === 4, 'follow-up')
  expect(fake.modes).toEqual(['queue', 'queue', 'steer', 'queue'])
  expect(fake.prompts).toEqual(['idle question', 'idle follow-up', 'change of plan', 'later, please'])
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('TTY mode shows the Host inbox above the composer and Alt-Up restores it', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  fake.inbox({
    steering: [{ id: 'steer-1', text: 'prefer the  smaller diff' }],
    followUp: [{ id: 'queue-1', text: 'then run the tests' }],
  })
  await waitFor(() => tty.painted().includes('Steering: prefer the smaller diff'), 'pending steering row')
  expect(tty.painted()).toContain('Follow-up: then run the tests')
  expect(tty.painted()).toContain('alt+up to edit all queued messages')

  tty.input.write('\u001b[1;3A') // Alt-Up: pi's dequeue gesture
  await waitFor(() => fake.removes.length === 2, 'dequeue requests')
  expect(fake.removes).toEqual(['steer-1', 'queue-1'])
  await waitFor(() => tty.painted().includes('restored 2 queued messages'), 'dequeue notice')

  // The restored text is back in the composer verbatim (the extra space only
  // collapses in the one-line preview), in the order pi drains it.
  tty.input.write('\r')
  await waitFor(() => fake.prompts.length === 1, 'resubmitted draft')
  expect(fake.prompts).toEqual(['prefer the  smaller diff\n\nthen run the tests'])
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('TTY mode leaves a queued message with attachments in the queue', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  fake.inbox({ steering: [], followUp: [{ id: 'image-1' }, { id: 'queue-1', text: 'text only' }] })
  await waitFor(() => tty.painted().includes('Follow-up: (attachments)'), 'attachment row')
  tty.input.write('\u001b[1;3A')
  await waitFor(() => fake.removes.length === 1, 'dequeue request')
  expect(fake.removes).toEqual(['queue-1'])
  await waitFor(() => tty.painted().includes('kept 1 queued message with attachments in the queue'), 'held notice')
  tty.input.write('\u0003') // Ctrl-C clears the restored draft so /quit is a command again
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('TTY mode replaces the composer with the pi-style model selector', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  tty.input.write('/model\r')
  await waitFor(() => tty.painted().includes('Only configured providers'), 'model selector')
  expect(tty.painted()).toContain('DeepSeek-V4.1-Flash')
  expect(tty.painted()).toContain('Tab 推理强度')
  // Escape puts the composer back instead of leaving a floating dialog behind.
  const mark = tty.painted().length
  tty.input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 60)) // pi-tui waits out a lone escape
  await waitFor(() => tty.painted().slice(mark).includes('❯'), 'composer restored')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('TTY mode selects a model from the in-flow selector', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  tty.input.write('/model\r')
  await waitFor(() => tty.painted().includes('Only configured providers'), 'model selector')
  tty.input.write('\r')
  await waitFor(() => fake.models.length === 1, 'model selection')
  expect(fake.models).toEqual(['deepseek-official/deepseek-flash'])
  await waitFor(() => tty.painted().includes('model deepseek-official/deepseek-flash'), 'model notice')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('TTY mode adds a provider API key through the /login panels', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  tty.input.write('/login\r')
  await waitFor(() => tty.painted().includes('Select a provider to add an API key:'), 'provider picker')
  expect(tty.painted()).toContain('✓ configured')
  expect(tty.painted()).toContain('• not configured')
  tty.input.write('\r')
  await waitFor(() => tty.painted().includes('Login to DeepSeek'), 'api key field')
  // The key is masked in the terminal; only the Host sees the plaintext.
  tty.input.write('sk-test-key\r')
  await waitFor(() => fake.logins.length === 1, 'credential write')
  expect(fake.logins).toEqual([{ providerId: 'deepseek-official', apiKey: 'sk-test-key' }])
  expect(tty.painted()).not.toContain('sk-test-key')
  // The login adopts the provider's first model because the Session's default
  // route was not routable.
  await waitFor(() => fake.models.length === 1, 'adopted model')
  expect(fake.models).toEqual(['deepseek-official/deepseek-flash'])
  await waitFor(() => tty.painted().includes('saved an API key for DeepSeek'), 'login notice')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('TTY mode cancels the /login key field without storing anything', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  tty.input.write('/login deepseek-official\r')
  await waitFor(() => tty.painted().includes('Login to DeepSeek'), 'api key field')
  tty.input.write('sk-discarded')
  const mark = tty.painted().length
  tty.input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 60)) // pi-tui waits out a lone escape
  await waitFor(() => tty.painted().slice(mark).includes('❯'), 'composer restored')
  expect(fake.logins).toEqual([])
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('TTY mode walks the prompt history with Ctrl-P and Ctrl-N', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  tty.input.write('first question\r')
  await waitFor(() => fake.prompts.length === 1, 'first prompt')
  tty.input.write('\u0010') // Ctrl-P recovers the entry, Enter submits it again.
  tty.input.write('\r')
  await waitFor(() => fake.prompts.length === 2, 'recalled prompt')
  expect(fake.prompts).toEqual(['first question', 'first question'])
  tty.input.write('\u0010') // Ctrl-P recalls again, Ctrl-N returns to the empty draft.
  tty.input.write('\u000e')
  tty.input.write('\r')
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(fake.prompts).toHaveLength(2)
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

/**
 * A pty backend that behaves like Neovim refusing to leave a dirty buffer:
 * `:qa` exits only while every buffer can be written, `:wall` clears them, and
 * `:qa!` always leaves — exactly the contract the exit gate is built on.
 */
function fakeEditor(options: { clean: boolean }): {
  module: PtyModule
  writes(): string
  spawned(): boolean
  saves(): number
} {
  const writes: string[] = []
  let clean = options.clean
  let spawned = false
  let saves = 0
  let exit: ((event: { exitCode: number }) => void) | undefined
  const module: PtyModule = {
    spawn() {
      spawned = true
      let data: ((chunk: string) => void) | undefined
      return {
        pid: 1,
        onData(handler) { data = handler },
        onExit(handler) { exit = handler },
        write(chunk) {
          writes.push(chunk)
          if (chunk.includes('wall') || chunk.includes('write!')) { clean = true; saves += 1 }
          const leave = chunk.includes(':qa!') || (chunk.includes(':qa') && clean)
          if (leave) queueMicrotask(() => exit?.({ exitCode: 0 }))
        },
        resize() {},
        kill() {},
      }
    },
  }
  return { module, writes: () => writes.join(''), spawned: () => spawned, saves: () => saves }
}

/** A TTY client whose editor column runs {@link fakeEditor}. */
function startEditorTty(
  home: string,
  fake: FakeBackend,
  editor: PtyModule,
): { input: PassThrough & { isTTY: true; setRawMode(mode: boolean): void; setEncoding(): void }; painted(): string; run: Promise<number> } {
  const input = Object.assign(new PassThrough(), {
    isTTY: true as const,
    setRawMode: (_mode: boolean): void => undefined,
    setEncoding: (): void => undefined,
  })
  const output = Object.assign(new PassThrough(), { isTTY: true as const, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  const previousHome = process.env.HULALA_HOME
  process.env.HULALA_HOME = home
  const run = runTerminalClient({ backend: fake.backend, cwd: home, input, output, resume: 'session-1234', pty: editor })
  cleanups.push(async () => {
    // Leave even when an assertion threw: a dirty editor needs the dialog's
    // discard key before the client can stop on its own.
    input.write('/quit\r')
    await new Promise(resolve => setTimeout(resolve, 80))
    input.write('d')
    await Promise.race([run, new Promise(resolve => setTimeout(resolve, 900))])
    input.destroy()
    output.destroy()
    if (previousHome === undefined) delete process.env.HULALA_HOME
    else process.env.HULALA_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })
  return { input, painted: () => text, run }
}

/** Open the editor column and hand the keyboard back to the composer. */
async function openEditorAndBlur(tty: ReturnType<typeof startEditorTty>, editor: ReturnType<typeof fakeEditor>): Promise<void> {
  tty.input.write('\u0014') // Ctrl-T: show and focus the editor column
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write('\u001b') // Ctrl-[ : back to the composer, column stays
  await new Promise(resolve => setTimeout(resolve, 60))
}

test('quitting a clean editor asks nothing and leaves through :qa', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-gate-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startEditorTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  await openEditorAndBlur(tty, editor)
  tty.input.write('\u0004') // Ctrl-D quits from the empty composer
  await expect(tty.run).resolves.toBe(0)
  expect(tty.painted()).not.toContain('有未保存的文件')
  expect(editor.writes()).toContain(':qa')
})

test('quitting an editor Neovim will not leave asks, and Escape keeps the client', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-gate-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: false })
  const tty = startEditorTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  await openEditorAndBlur(tty, editor)

  tty.input.write('\u0004')
  await waitFor(() => tty.painted().includes('有未保存的文件'), 'confirm dialog')
  tty.input.write('\u001b') // Escape cancels the quit
  await new Promise(resolve => setTimeout(resolve, 120))
  tty.input.write('still-here\r')
  await waitFor(() => fake.prompts.includes('still-here'), 'the client kept running')

  tty.input.write('/quit\r')
  await new Promise(resolve => setTimeout(resolve, 1600)) // grace period, then the dialog
  tty.input.write('d') // discard: leave without writing
  await expect(tty.run).resolves.toBe(0)
  expect(editor.writes()).toContain(':qa!')
  expect(editor.saves()).toBe(0)
})

test('saving from the dialog writes every buffer before leaving', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-gate-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: false })
  const tty = startEditorTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  await openEditorAndBlur(tty, editor)

  tty.input.write('\u0004')
  await waitFor(() => tty.painted().includes('有未保存的文件'), 'confirm dialog')
  tty.input.write('s') // save all, then Neovim leaves on its own
  await expect(tty.run).resolves.toBe(0)
  expect(editor.saves()).toBe(1)
  expect(editor.writes()).toContain('wall')
})

test('a file changed on disk by the agent becomes a question, not a clobber', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-conflict-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: false })
  const tty = startEditorTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  await openEditorAndBlur(tty, editor)

  // What `init.lua` appends when autosave finds the buffer dirty and the file
  // already rewritten on disk.
  const marker = join(home, 'cache', 'editor', `conflict-${process.pid}.txt`)
  mkdirSync(dirname(marker), { recursive: true })
  writeFileSync(marker, `${join(home, 'notes.md')}\t${Date.now()}\n`)

  await waitFor(() => tty.painted().includes('在磁盘上被改过'), 'conflict dialog')
  tty.input.write('k') // keep mine: force the write
  await waitFor(() => editor.writes().includes(':write!'), 'forced write')
  expect(readFileSync(marker, 'utf8')).toBe('')

  tty.input.write('\u0004')
  await expect(tty.run).resolves.toBe(0)
})


test('/update installs the downloaded release and restarts into it', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  let applied = 0
  let restarted: string | undefined
  const run = runTerminalClient({
    backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234',
    updateCheck: async () => ({ currentVersion: '0.1.15', latestVersion: '0.1.16', downloaded: true }),
    applyUpdate: async () => { applied += 1; return { ok: true, message: 'Hulala 0.1.16 updated' } },
    restartClient: resume => { restarted = resume },
  })
  // The first screen already says the release is downloaded and names the command.
  await waitFor(() => text.includes('/update'), 'downloaded update notice')
  input.write('/update\r')
  await expect(run).resolves.toBe(0)
  expect(applied).toBe(1)
  expect(restarted).toBe('session-1234')
})

test('/update reports a failed install and keeps the client running', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  let restarted = false
  const run = runTerminalClient({
    backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234',
    updateCheck: async () => ({ currentVersion: '0.1.15', latestVersion: '0.1.16', downloaded: true }),
    applyUpdate: async () => ({ ok: false, message: 'Downloaded archive SHA-256 mismatch' }),
    restartClient: () => { restarted = true },
  })
  await waitFor(() => text.includes('/update'), 'downloaded update notice')
  input.write('/update\r')
  await waitFor(() => text.includes('SHA-256 mismatch'), 'failure notice')
  expect(restarted).toBe(false)
  input.write('still-here\r')
  await waitFor(() => fake.prompts.includes('still-here'), 'the client kept running')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('the composer takes input again after Ctrl-T closes the editor column', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-reclose-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startEditorTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write('\u0014') // Ctrl-T: open and focus the editor
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write('\u0014') // Ctrl-T: close it again (Neovim is clean)
  await new Promise(resolve => setTimeout(resolve, 300))

  tty.input.write('after-close\r')
  await waitFor(() => fake.prompts.includes('after-close'), 'the composer has the keyboard again')
  tty.input.write('\u0004')
  await expect(tty.run).resolves.toBe(0)
})

test('the composer takes input after discarding an unsaved buffer on close', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-discard-close-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: false })
  const tty = startEditorTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write('\u0014')
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write('\u0014') // close: Neovim refuses, so the dialog appears
  await waitFor(() => tty.painted().includes('有未保存的文件'), 'confirm dialog')
  tty.input.write('d') // discard
  await new Promise(resolve => setTimeout(resolve, 300))

  tty.input.write('after-discard\r')
  await waitFor(() => fake.prompts.includes('after-discard'), 'the composer has the keyboard again')
  tty.input.write('\u0004')
  await expect(tty.run).resolves.toBe(0)
})

test('a dialog left open when the editor exits does not disable the keyboard', async () => {
  // Neovim taking longer than the grace period and then leaving on its own is
  // the case that used to strand the client: the dialog stayed open, so every
  // keystroke was dropped while the composer looked focused.
  const home = mkdtempSync(join(tmpdir(), 'hulala-slow-close-'))
  const fake = fakeBackend(home)
  const writes: string[] = []
  let exit: ((event: { exitCode: number }) => void) | undefined
  let spawned = false
  const module: PtyModule = {
    spawn() {
      spawned = true
      return {
        pid: 1,
        onData() {},
        onExit(handler) { exit = handler },
        write(chunk) {
          writes.push(chunk)
          if (chunk.includes(':qa')) setTimeout(() => exit?.({ exitCode: 0 }), 1500)
        },
        resize() {},
        kill() {},
      }
    },
  }
  const tty = startEditorTty(home, fake, module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write('\u0014')
  await waitFor(() => spawned, 'editor column')
  tty.input.write('\u0014') // close: no exit yet, so the dialog appears
  await waitFor(() => tty.painted().includes('有未保存的文件'), 'confirm dialog')
  await new Promise(resolve => setTimeout(resolve, 900)) // the process leaves with the dialog up

  tty.input.write('after-slow-close\r')
  await waitFor(() => fake.prompts.includes('after-slow-close'), 'the composer takes input again')
  tty.input.write('\u0004')
  await expect(tty.run).resolves.toBe(0)
})

test('a slow but committed quit is not mistaken for unsaved work', async () => {
  // Neovim's `VimLeavePre` marker is the answer to "is this quitting or refusing?";
  // without it the client would fall back to its grace period and ask.
  const home = mkdtempSync(join(tmpdir(), 'hulala-leave-marker-'))
  const fake = fakeBackend(home)
  let exit: ((event: { exitCode: number }) => void) | undefined
  let spawned = false
  const leaveFile = join(home, 'cache', 'editor', `leave-${process.pid}.txt`)
  const module: PtyModule = {
    spawn() {
      spawned = true
      return {
        pid: 1,
        onData() {},
        onExit(handler) { exit = handler },
        write(chunk) {
          if (!chunk.includes(':qa')) return
          mkdirSync(join(home, 'cache', 'editor'), { recursive: true })
          setTimeout(() => writeFileSync(leaveFile, 'leaving'), 200)
          setTimeout(() => exit?.({ exitCode: 0 }), 2000)
        },
        resize() {},
        kill() {},
      }
    },
  }
  const tty = startEditorTty(home, fake, module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write('\u0014')
  await waitFor(() => spawned, 'editor column')
  tty.input.write('\u0014') // close: committed, just slow
  await new Promise(resolve => setTimeout(resolve, 2600))

  expect(tty.painted()).not.toContain('有未保存的文件')
  tty.input.write('after-slow-quit\r')
  await waitFor(() => fake.prompts.includes('after-slow-quit'), 'the composer keeps working')
  tty.input.write('\u0004')
  await expect(tty.run).resolves.toBe(0)
})
