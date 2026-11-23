import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import { runTerminalClient } from '../../src/tui/app.js'
import type { PtyModule } from '../../src/tui/editor/pty.js'
import { decodeMsgpack, encodeMsgpack, type Msgpack } from '../../src/tui/editor/msgpack.js'
import type { EditorChannel } from '../../src/tui/data/editorChannel.js'
import type {
  HostConnection,
  HostEditor,
  SessionListEvent,
  TerminalApproval,
  TerminalApprovalDecision,
  TerminalApprovalOutcome,
  TerminalBackend,
  TerminalInbox,
  TerminalModelCatalog,
  TerminalPendingQuestion,
  TerminalPromptMode,
  TerminalQuestion,
  TerminalQuestionAnswer,
  TerminalQuestionDecision,
  TerminalQuestionRequest,
  TerminalSession,
  TerminalSessionHandlers,
} from '../../src/tui/data/remote.js'

/** Command chords as a terminal that took the Kitty keyboard report delivers them. */
/** `Ctrl-Shift-I`: the Neovim-only mode (a chord, not the `Tab` byte). */
const NEVIM_ONLY = '\u001b[105;6u'
const SHIFT_CMD_S = '\u001b[115;10u' // Session rail
const SHIFT_CMD_C = '\u001b[99;10u' // conversation
const SHIFT_CMD_K = '\u001b[107;10u' // command palette
/** The panel moves and the session walk, as a Kitty keyboard report delivers them. */
const SHIFT_CMD_H = '\u001b[104;10u' // leftward move
const SHIFT_CMD_L = '\u001b[108;10u' // rightward move
/** Session stepping: the Command spelling, as a Kitty keyboard report sends it. */
const SESSION_NEXT = '\u001b[1;10B' // Shift-Cmd-Down
const SESSION_PREVIOUS = '\u001b[1;10A' // Shift-Cmd-Up
/** The same pair for a terminal where a Command chord never arrives. */
const SESSION_NEXT_LEGACY = '\u001b[1;6B' // Ctrl-Shift-Down
const SESSION_PREVIOUS_LEGACY = '\u001b[1;6A' // Ctrl-Shift-Up
/** `Ctrl-D` in a legacy encoding: the editor column's toggle. */
const CTRL_D = '\u0004'
/** `Ctrl-T` in a legacy encoding: the terminal column's toggle. */
const CTRL_T = '\u0014'

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
  /** Reasoning effort of each model selection, in call order. */
  efforts: Array<string | undefined>
  /** Command lines the client dispatched to the Host. */
  hostCommands: string[]
  /** Directories a new Session was requested in. */
  workspaces: string[]
  /** Make the next workspace creation fail, as a Host with no such directory does. */
  failWorkspace(reason: string): void
  /** Session ids the fake Host created. */
  created: string[]
  /** Session ids the client attached its follow stream to, in call order. */
  followed: string[]
  /** Presets the client asked the Host to apply to a Session, in request order. */
  permissions: string[]
  /** Presets the client asked the Host to store as the new-Session default. */
  permissionDefaults: string[]
  /** Session ids each `setPermission` call named, in call order. */
  permissionSessions: string[]
  /** How many times the Session list was fetched (the picker fetches it again). */
  listSessionsCalls(): number
  handlers: TerminalSessionHandlers | undefined
  approve(request: TerminalApproval): Promise<TerminalApprovalDecision>
  ask(request: TerminalQuestionRequest): Promise<TerminalQuestionDecision>
  /** Publish both pending lists the way the Host's `inbox` projection does. */
  inbox(inbox: TerminalInbox): void
  /** Publish the `userQuestions` projection the way the Host's control stream does. */
  questions(pending: readonly TerminalPendingQuestion[]): void
  /** Publish the `permissions` projection the way the Host's control stream does. */
  permission(preset: string): void
  /** Publish one Host Session-list event. */
  listEvent(event: SessionListEvent): void
  /** Sessions the fake Host hands out from `listSessions`. */
  setSessions(sessions: TerminalSession[]): void
  /** Foreground waits a question card claimed, in call order. */
  waits(): readonly { sessionId: string; callId: string }[]
  /** Claims the client released. */
  disposed(): number
  /** Remaining window the next attach reports, in milliseconds. */
  setWaitRemaining(remainingMs: number): void
  /** Late answers the client submitted through `userQuestions.answer`. */
  answers(): readonly { sessionId: string; callId: string; answers: readonly TerminalQuestionAnswer[] }[]
  /** What `answerQuestion` should report; a queued reply rejects with `REPLY_QUEUED`. */
  setAnswerResult(result: boolean | 'queued'): void
}

/** What a test may replace in the fake Host without rebuilding it. */
interface FakeBackendOptions {
  /**
   * Replace the model catalog read. A test that never resolves it is how a
   * carrier that stalls mid-RPC is simulated: nothing else in the client is
   * allowed to depend on that call.
   */
  readonly catalog?: () => Promise<TerminalModelCatalog>
  /** The transport's state source, when a test needs to forge a reconnect. */
  readonly connection?: HostConnection
}

function fakeBackend(sessionCwd = '/workspace', options: FakeBackendOptions = {}): FakeBackend {
  const prompts: string[] = []
  const modes: TerminalPromptMode[] = []
  const removes: string[] = []
  const cancels: string[] = []
  const logins: Array<{ providerId: string; apiKey: string }> = []
  const models: string[] = []
  const efforts: Array<string | undefined> = []
  /** Directories `ensureWorkspace` was asked for, in call order. */
  const workspaces: string[] = []
  /** Session ids the fake Host handed out. */
  const created: string[] = []
  const followed: string[] = []
  const permissions: string[] = []
  const permissionDefaults: string[] = []
  const permissionSessions: string[] = []
  const hostCommands: string[] = []
  let listSessionsCalls = 0
  let approval: ((request: TerminalApproval) => Promise<TerminalApprovalDecision>) | undefined
  let question: ((request: TerminalQuestionRequest) => Promise<TerminalQuestionDecision>) | undefined
  let liveHandlers: TerminalSessionHandlers | undefined
  let sessionList: ((event: SessionListEvent) => void) | undefined
  /** Foreground waits a question card claimed, in call order. */
  const waits: { sessionId: string; callId: string }[] = []
  /** Claims the client let go of; every card that showed must release its own. */
  let disposed = 0
  let waitRemainingMs = 60_000
  /** Late answers steered through `userQuestions.answer`, in call order. */
  const answers: { sessionId: string; callId: string; answers: readonly TerminalQuestionAnswer[] }[] = []
  /** `false` = no longer continued; `'queued'` = a reply is already in the inbox. */
  let answerResult: boolean | 'queued' = true
  let hostSessions: TerminalSession[] = []
  let workspaceFailure: string | undefined
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
    async ensureWorkspace(path) {
      workspaces.push(path)
      if (workspaceFailure !== undefined) throw new Error(workspaceFailure)
      return 'workspace-1'
    },
    async defaultWorkspace() { return { id: 'workspace-default', path: '/host/workspace' } },
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
    ...(options.connection === undefined ? {} : { connection: options.connection }),
    async modelCatalog() {
      if (options.catalog !== undefined) return await options.catalog()
      return {
        default: { provider: 'test', model: 'test-model' },
        groups: [{
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [{
            id: 'deepseek-flash',
            name: 'DeepSeek-V4.1-Flash',
            reasoning: {
              efforts: [
                { id: 'off', name: 'Off', description: 'Use for simple tasks that do not need reasoning.' },
                { id: 'low', name: 'Low', description: 'Prefer for routine tasks.' },
                { id: 'max', name: 'Max', description: 'Reserve for the hardest quality-first tasks.' },
              ],
              defaultEffort: 'off',
            },
          }],
        }],
        failures: [],
      }
    },
    async selectModel(_sessionId, selection) {
      models.push(`${selection.provider}/${selection.model}`)
      efforts.push(selection.reasoningEffort)
    },
    async permissionCatalog() {
      const preset = (value: string) => ({ value, name: value })
      const options = [preset('read-only'), preset('workspace-write'), preset('danger-full-access')]
      return { options, defaultOptions: options, defaultPreset: 'workspace-write' }
    },
    async setPermission(sessionId, preset) { permissions.push(preset); permissionSessions.push(sessionId) },
    async commandCatalog() {
      return [{
        name: 'compact',
        description: 'Compact older conversation history',
        definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-compact'),
      }]
    },
    async runCommand(_sessionId, line) {
      hostCommands.push(line)
      // The Host's registry answers `undefined` for a line no command claims,
      // which is how a client tells "unknown" from "failed".
      const name = line.slice(1).split(/\s+/u)[0]?.toLowerCase()
      if (name !== 'compact' && name !== '压缩') return undefined
      return { kind: 'success' as const, text: 'Compacted 3 history items (~1200 tokens).' }
    },
    async setDefaultPermission(preset) { permissionDefaults.push(preset) },
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
    async answerQuestion(sessionId, callId, answer) {
      answers.push({ sessionId, callId, answers: answer })
      if (answerResult === 'queued') {
        const error = new Error('REPLY_QUEUED') as Error & { code: string }
        error.code = 'REPLY_QUEUED'
        throw error
      }
      return answerResult
    },
    attachQuestionWait(sessionId, callId, signal) {
      waits.push({ sessionId, callId })
      return {
        // One Host-computed frame, then silence: the claim is held until the
        // client closes it, which is the contract `askTimed` gives a client.
        frames: (async function* () {
          yield { remainingMs: waitRemainingMs }
          await new Promise<void>(settle => {
            signal.addEventListener('abort', () => { settle() }, { once: true })
          })
        })(),
        dispose() { disposed += 1 },
      }
    },
    onSessionStatus() { return () => undefined },
    onSessionError() { return () => undefined },
    onSessionList(handler) { sessionList = handler; return () => { sessionList = undefined } },
    async close() {},
  }
  return {
    backend,
    /** Make the next `ensureWorkspace` fail, as a Host with no such directory does. */
    failWorkspace(reason: string): void { workspaceFailure = reason },
    prompts,
    modes,
    removes,
    cancels,
    logins,
    models,
    efforts,
    workspaces,
    created,
    followed,
    permissions,
    permissionDefaults,
    permissionSessions,
    hostCommands,
    listSessionsCalls: () => listSessionsCalls,
    get handlers() { return liveHandlers },
    approve: request => {
      if (approval === undefined) throw new Error('approval handler is not subscribed')
      return approval(request)
    },
    ask: request => {
      if (question === undefined) throw new Error('question handler is not subscribed')
      return question(request)
    },
    inbox: inbox => {
      if (liveHandlers === undefined) throw new Error('follow handler is not subscribed')
      liveHandlers.onInbox?.(inbox)
    },
    questions: pending => {
      if (liveHandlers === undefined) throw new Error('follow handler is not subscribed')
      liveHandlers.onUserQuestions?.(pending)
    },
    permission: preset => {
      if (liveHandlers === undefined) throw new Error('follow handler is not subscribed')
      liveHandlers.onPermission?.(preset)
    },
    listEvent: event => {
      if (sessionList === undefined) throw new Error('session list handler is not subscribed')
      sessionList(event)
    },
    setSessions: sessions => { hostSessions = [...sessions] },
    waits: () => [...waits],
    disposed: () => disposed,
    setWaitRemaining: remainingMs => { waitRemainingMs = remainingMs },
    answers: () => [...answers],
    setAnswerResult: result => { answerResult = result },
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
  await waitFor(() => (text.match(/─/gu) ?? []).length >= 2, 'editor borders')
  input.write('hello\r')
  await waitFor(() => fake.prompts.includes('hello'), 'prompt')
  await waitFor(() => (text.match(/─/gu) ?? []).length >= 2, 'borders after submit')
  expect(fake.prompts).toContain('hello')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

/**
 * A palette query's reply burst, exactly as the terminal sends it. The first
 * round belongs to pi-tui's startup query; the second is a stale one held in the
 * canonical tty buffer and released at the next raw-mode switch.
 */
const stalePaletteRound = [
  '\u001b[6;34;16t',
  '\u001b]10;rgb:ffff/ffff/ffff\u0007',
  '\u001b]11;rgb:2828/2c2c/3434\u0007',
  ...Array.from({ length: 16 }, (_, i) => `\u001b]4;${String(i)};rgb:1d1d/1f1f/2121\u0007`),
  '\u001b[?62;22;52c',
].join('')

test('TTY mode swallows a stale palette reply instead of typing it into the composer', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 40 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
  await waitFor(() => (text.match(/─/gu) ?? []).length >= 2, 'editor borders')
  // The startup query consumes its own round; a second, stale round has no
  // consumer but the client's gate. Without it, `62`, `22t` and `52c` join the
  // draft and the prompt is not `hello` any more.
  input.write(stalePaletteRound)
  input.write(stalePaletteRound)
  input.write('hello\r')
  await waitFor(() => fake.prompts.length > 0, 'prompt')
  expect(fake.prompts).toEqual(['hello'])
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('TTY mode puts the Session directory on the window title', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  // Started in `/launch`; the Session the Host lists works in `/workspace`. The
  // machine is injected: a remote tab names it, and it must not depend on whoever
  // runs this suite.
  const run = runTerminalClient({
    backend: fake.backend,
    cwd: '/launch',
    input,
    output,
    resume: 'session-1234',
    machine: { user: 'root', host: 'dev' },
    escapeTimeoutMs: 20,
  })
  await waitFor(() => text.includes('\u001b]0;root@dev:workspace - Hulala\u0007'), 'window title')
  // The Host names the Session after its first turn; the name hangs off the
  // product name and cannot end the OSC sequence early.
  fake.handlers?.onEvent({ type: 'session/title', seq: 4, time: Date.now(), data: { title: 'Fix the composer\u0007' } })
  await waitFor(() => text.includes('\u001b]0;root@dev:workspace - Hulala:Fix the composer \u0007'), 'named window title')
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
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
  expect(text).toContain('/update installs it and restarts')
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
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

test('Shift-Cmd-H moves the keyboard left instead of cancelling the turn', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  fake.handlers?.onRunning(true)
  await waitFor(() => plain(tty.painted()).includes('Deep diving for'), 'running indicator')
  // The leftward move is its own chord, so a running turn has to survive it —
  // that is the whole reason it is not `Ctrl-[` any more.
  tty.input.write(SHIFT_CMD_H)
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(fake.cancels).toEqual([])
  // The keyboard did move: `n` creates a Session instead of typing into the
  // composer, which is what a focused rail does with the key.
  tty.input.write('n')
  await waitFor(() => fake.created.length === 1, 'new Session')
  fake.handlers?.onRunning(false)
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Ctrl-Shift-H is the same leftward move for a terminal without Command', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  fake.handlers?.onRunning(true)
  await waitFor(() => plain(tty.painted()).includes('Deep diving for'), 'running indicator')
  tty.input.write('\u001b[104;6u') // Ctrl-Shift-H
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(fake.cancels).toEqual([])
  tty.input.write('n')
  await waitFor(() => fake.created.length === 1, 'new Session')
  fake.handlers?.onRunning(false)
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Shift-Cmd-H leaves a column that is keeping the Esc key', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-insert-leave-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write(CTRL_D) // Ctrl-D: the Neovim column takes the keyboard
  await waitFor(() => editor.spawned(), 'editor column')
  // Insert mode owns `Esc`, so the client does not take it back...
  editor.emit('mode_change', 'insert', 1)
  await new Promise(resolve => setTimeout(resolve, 60))
  tty.input.write('\u001b')
  await waitFor(() => editor.writes().includes('<Esc>'), 'insert mode keeps Escape')
  // ...while the leftward chord is never the program's: no column can read one.
  tty.input.write(SHIFT_CMD_H)
  await new Promise(resolve => setTimeout(resolve, 80))
  tty.input.write('from-composer\r')
  await waitFor(() => fake.prompts.includes('from-composer'), 'the composer has the keyboard')
  tty.input.write(CTRL_D) // and close the column; Neovim is clean, so it leaves
  await new Promise(resolve => setTimeout(resolve, 200))
  tty.input.write('\u0011')
  await expect(tty.run).resolves.toBe(0)
})

test('Shift-Cmd-H leaves the rail while the filter box has the keyboard', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  tty.input.write('\u001b') // idle empty composer: the rail takes the keyboard
  await new Promise(resolve => setTimeout(resolve, 80))
  tty.input.write('/') // the filter box is nested inside the rail
  await new Promise(resolve => setTimeout(resolve, 80))
  tty.input.write('abc')
  await new Promise(resolve => setTimeout(resolve, 80))
  // The filter box owns `Esc` (to clear the query), not the move: the chord
  // leaves the rail with the filter open.
  tty.input.write(SHIFT_CMD_H)
  await new Promise(resolve => setTimeout(resolve, 80))
  tty.input.write('typed-after\r')
  await waitFor(() => fake.prompts.includes('typed-after'), 'the composer has the keyboard')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Ctrl-Shift-Down and Ctrl-Shift-Up walk the Session list from the composer', async () => {
  const fake = fakeBackend()
  fake.setSessions([
    { sessionId: 'session-1234', updatedAt: Date.now(), running: false, blank: false, cwd: '/workspace', title: 'current one' },
    { sessionId: 'session-aaaa', updatedAt: Date.now() - 60_000, running: false, blank: false, cwd: '/workspace', title: 'older one' },
    { sessionId: 'session-bbbb', updatedAt: Date.now() - 120_000, running: false, blank: false, cwd: '/workspace', title: 'oldest one' },
  ])
  const tty = startTty(fake)
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  tty.input.write(SESSION_NEXT)
  await waitFor(() => fake.followed.includes('session-aaaa'), 'the next Session')
  tty.input.write(SESSION_PREVIOUS)
  await waitFor(() => fake.followed.at(-1) === 'session-1234', 'the previous one')
  tty.input.write(SESSION_PREVIOUS)
  await waitFor(() => fake.followed.at(-1) === 'session-bbbb', 'the walk wraps')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Escape reported through the keyboard protocol still cancels the turn', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  fake.handlers?.onRunning(true)
  await waitFor(() => plain(tty.painted()).includes('Deep diving for'), 'running indicator')
  // The Kitty report spells `Esc` `CSI 27u`. Separating the chord must not take
  // the interrupt away from the key that owns it.
  tty.input.write('\u001b[27u')
  await waitFor(() => fake.cancels.length === 1, 'cancel request')
  expect(fake.cancels).toEqual(['session-1234'])
  fake.handlers?.onRunning(false)
  fake.handlers?.onEvent({ type: 'turn/end', seq: 3, time: Date.now(), data: { reason: { kind: 'aborted' } } })
  await waitFor(() => plain(tty.painted()).includes('Turn cancelled'), 'cancelled turn')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('TTY mode lets an open completion menu close on Escape before it cancels', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/launch', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
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
  // Shift-Cmd-S is a visibility toggle: the visible rail goes away without taking the
  // keyboard, and the double-Esc picker is the fallback once it is gone.
  input.write(SHIFT_CMD_S)
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

test('Esc then Ctrl-N and Enter switches to the next Session in the rail', async () => {
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
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

test('Shift-Cmd-S shows the rail and puts it away, and showing it takes the keyboard', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => plain(tty.painted()).includes('+ new session'), 'rail')
  // The rail is on screen and the composer has the keyboard. Shift-Cmd-S is not a
  // focus cycle: the first press puts the rail away instead of moving into it.
  const hiddenMark = tty.painted().length
  tty.input.write(SHIFT_CMD_S)
  await waitFor(() => !plain(tty.painted().slice(hiddenMark)).includes('+ new session'), 'rail hidden')
  // A hidden rail comes back with the keyboard on the list, which `n` proves by
  // creating a Session instead of typing into the composer.
  const shownMark = tty.painted().length
  tty.input.write(SHIFT_CMD_S)
  await waitFor(() => plain(tty.painted().slice(shownMark)).includes('+ new session'), 'rail shown')
  tty.input.write('n')
  await waitFor(() => fake.created.length === 1, 'new Session')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Shift-Cmd-S puts the rail away from the editor column and keeps Neovim focused', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-rail-toggle-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write(CTRL_D) // Ctrl-D: show and focus the Neovim column
  await waitFor(() => editor.spawned(), 'editor column')
  // The rail is painted beside the editor. Shift-Cmd-S hides it without stealing the
  // keyboard: leaving the column is Shift-Cmd-H, and this key only shows or hides.
  const mark = tty.painted().length
  tty.input.write(SHIFT_CMD_S)
  await waitFor(() => !plain(tty.painted().slice(mark)).includes('+ new session'), 'rail hidden')
  tty.input.write('x')
  await waitFor(() => editor.writes().includes('x'), 'keys still reach nvim')
  tty.input.write('\u0011') // Ctrl-Q quits; Neovim is clean
  await expect(tty.run).resolves.toBe(0)
  expect(editor.writes()).toContain(':qa')
})

test('Shift-Cmd-C puts the conversation away beside the rail, and brings the draft back', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write('draft kept')
  await new Promise(resolve => setTimeout(resolve, 60))
  const mark = tty.painted().length
  tty.input.write(SHIFT_CMD_C) // Shift-Cmd-C: hide the conversation, keyboard lands on the rail
  await waitFor(() => !plain(tty.painted().slice(mark)).includes('history answer'), 'conversation hidden')
  // The keyboard moved onto the rail, whose rows now fill the frame.
  await waitFor(() => plain(tty.painted().slice(mark)).includes('+ new session'), 'rail keeps the frame')
  tty.input.write(SHIFT_CMD_C) // Shift-Cmd-C again: the conversation and its composer return
  await waitFor(() => plain(tty.painted().slice(mark)).includes('❯'), 'composer restored')
  tty.input.write('\r')
  await waitFor(() => fake.prompts.includes('draft kept'), 'the draft survived the round trip')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Shift-Cmd-C refuses to hide the conversation when both side columns are closed', async () => {
  // 40 columns cannot hold the rail beside the conversation and no editor is
  // open, so there is nothing to hide the conversation behind.
  const fake = fakeBackend()
  const tty = startTty(fake, 40)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  const mark = tty.painted().length
  tty.input.write(SHIFT_CMD_C)
  await waitFor(() => plain(tty.painted().slice(mark)).includes('before hiding'), 'refusal notice')
  tty.input.write('still-home\r')
  await waitFor(() => fake.prompts.includes('still-home'), 'the composer kept the keyboard')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Shift-Cmd-C hides the conversation from the editor and keeps Neovim focused', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-chat-toggle-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write(CTRL_D) // Ctrl-D: show and focus the Neovim column
  await waitFor(() => editor.spawned(), 'editor column')
  const mark = tty.painted().length
  tty.input.write(SHIFT_CMD_C) // Shift-Cmd-C: the conversation goes, the editor keeps the keyboard
  await waitFor(() => !plain(tty.painted().slice(mark)).includes('history answer'), 'conversation hidden')
  tty.input.write('x')
  await waitFor(() => editor.writes().includes('x'), 'keys still reach nvim')
  tty.input.write(SHIFT_CMD_C) // Shift-Cmd-C again: the composer comes back with the keyboard
  await waitFor(() => plain(tty.painted().slice(mark)).includes('❯'), 'composer restored')
  tty.input.write('back-home\r')
  await waitFor(() => fake.prompts.includes('back-home'), 'composer takes input again')

  // Hiding again and closing the editor with Ctrl-D brings the conversation
  // back with the composer, instead of leaving the keyboard on nothing.
  const closeMark = tty.painted().length
  tty.input.write(SHIFT_CMD_C)
  await waitFor(() => !plain(tty.painted().slice(closeMark)).includes('history answer'), 'conversation hidden again')
  tty.input.write(CTRL_D) // Ctrl-D: close the editor; it is clean
  await waitFor(() => plain(tty.painted().slice(closeMark)).includes('❯'), 'conversation back after close')
  tty.input.write('after-close\r')
  await waitFor(() => fake.prompts.includes('after-close'), 'composer focus after closing the editor')

  tty.input.write('\u0011') // Ctrl-Q quits; Neovim is clean
  await expect(tty.run).resolves.toBe(0)
  expect(editor.writes()).toContain(':qa')
})

test('leaving the rail with Escape brings a hidden conversation back', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  const mark = tty.painted().length
  tty.input.write(SHIFT_CMD_C) // hide: the keyboard lands on the rail
  await waitFor(() => !plain(tty.painted().slice(mark)).includes('history answer'), 'conversation hidden')
  tty.input.write('\u001b') // Escape leaves the rail, so the composer has to come back
  await waitFor(() => plain(tty.painted().slice(mark)).includes('❯'), 'composer restored')
  tty.input.write('esc-return\r')
  await waitFor(() => fake.prompts.includes('esc-return'), 'composer takes input')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a composer draft survives moving into the rail and back', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
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

test('Esc moves onto the rail before the first Session has opened', async () => {
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
  await waitFor(() => plain(text).includes('+ new session'), 'rail')
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
  await waitFor(() => text.includes('history answer'), 'transcript')
  await waitFor(() => plain(text).includes('+ new session'), 'rail rows')
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

test('Ctrl-L throws the renderer\'s copy of the screen away and paints every row', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 24 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
  const clears = (): number => (text.match(/\u001b\[2J/gu) ?? []).length
  await waitFor(() => plain(text).includes('history answer'), 'transcript')
  const before = clears()
  // `Ctrl-L` is the user's own repair: the frame is rebuilt from an empty model,
  // which is the clear plus every row. A differential repaint would keep every
  // cell the renderer believes is unchanged — the cells a lost frame left wrong.
  input.write('\u000c')
  await waitFor(() => clears() > before, 'full repaint')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('a Session the rail started blank takes its title from the journal', async () => {
  const fake = fakeBackend()
  // A Session created by `+ new session` carries the blank flag until the Host lists
  // it again, and the Host never sends a second summary for that transition.
  fake.setSessions([{ sessionId: 'session-1234', updatedAt: Date.now(), running: false, blank: true, cwd: '/workspace' }])
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 24 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
  await waitFor(() => plain(text).includes('new session'), 'blank rail row')
  fake.handlers?.onEvent({ type: 'user/message', seq: 3, time: Date.now(), data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } })
  fake.handlers?.onEvent({ type: 'session/title', seq: 4, time: Date.now(), data: { title: 'X Bio', source: { kind: 'fallback' } } })
  await waitFor(() => plain(text).includes('X Bio'), 'rail title')
  // A summary the Host published before the first prompt arrives late; it must
  // neither clear the title nor put the row back behind `new session`.
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

test('TTY mode opens the terminal with Ctrl-T and the editor with Ctrl-D', async () => {
  // A directory that does not exist: each column reports why it cannot start,
  // which names the column the key chose without spawning a process.
  const fake = fakeBackend('/hulala-missing-column-dir')
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/hulala-missing-column-dir', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
  await waitFor(() => text.includes('history answer'), 'transcript')
  input.write(CTRL_T) // Ctrl-T: the built-in terminal
  await waitFor(() => text.includes('terminal unavailable'), 'terminal column')
  expect(text).not.toContain('editor unavailable')
  input.write(CTRL_D) // Ctrl-D: Neovim
  await waitFor(() => text.includes('editor unavailable'), 'editor column')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('TTY mode leaves Ctrl-D to an open overlay', async () => {
  const fake = fakeBackend('/hulala-missing-column-dir')
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/hulala-missing-column-dir', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
  await waitFor(() => text.includes('history answer'), 'transcript')
  input.write('/help\r')
  await waitFor(() => text.includes('any key closes'), 'help overlay')
  input.write(CTRL_D) // Ctrl-D closes the overlay instead of opening the editor
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(text).not.toContain('editor unavailable')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('a focused column hands the caret to the terminal, in the shape nvim asked for', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-caret-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  // The composer paints its own caret, so the terminal's cursor stays hidden and
  // untouched while the keyboard is in the prompt: no DECSCUSR shape, and never
  // a show — a terminal cursor over the composer's block would blink there.
  await waitFor(() => tty.painted().includes('\u001b[?25l'), 'the client owns the caret')
  expect(tty.painted()).not.toContain('\u001b[2 q')
  expect(tty.painted()).not.toContain('\u001b[?25h')

  tty.input.write(CTRL_D) // Ctrl-D: the column takes the keyboard and the caret
  await waitFor(() => editor.spawned(), 'editor column')
  // A program that never asked for a shape gets the block a shell has always had,
  // drawn by the terminal at the cell the program marked.
  await waitFor(() => tty.painted().includes('\u001b[2 q'), 'block caret for the column')
  await waitFor(() => /\u001b\[\d+;\d+H\u001b\[\?25h/.test(tty.painted()), 'the terminal cursor is placed and shown')

  // Insert mode: Neovim reports the caret style as a mode event, and the client
  // asks the terminal for the same bar DECSCUSR would have described. The bar is
  // the terminal's, so it composites over the character instead of replacing it.
  editor.emit('mode_info_set', true, [{ cursor_shape: 'block' }, { cursor_shape: 'vertical' }])
  editor.emit('mode_change', 'insert', 1)
  await waitFor(() => tty.painted().includes('\u001b[6 q'), 'bar caret in insert mode')

  // Back to normal, then Esc leaves the column for the composer and the caret
  // goes with it. Escape itself belongs to insert mode, which Neovim just said.
  editor.emit('mode_change', 'normal', 0)
  await waitFor(() => tty.painted().includes('\u001b[2 q'), 'block caret in normal mode')
  tty.input.write('\u001b')
  await waitFor(() => tty.painted().includes('\u001b[0 q'), 'the caret returns to the client')

  tty.input.write(SHIFT_CMD_L) // Shift-Cmd-L: back into the column
  tty.input.write(CTRL_D) // and close it; Neovim is clean, so it leaves at once
  await new Promise(resolve => setTimeout(resolve, 200))
  tty.input.write('\u0011') // quit
  await expect(tty.run).resolves.toBe(0)
})

test('TTY mode keeps the sidebar open across focus changes and hands nvim its keys', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-sidebar-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_D) // Ctrl-D opens the Neovim column with the keyboard in it
  await waitFor(() => editor.spawned(), 'editor column')
  // The composer lost focus: its cursor stays visible as a half-opacity block
  // (or the hollow glyph when the test environment has colour off).
  await waitFor(() => /\u001b\[48;[25];/.test(tty.painted()) || tty.painted().includes('□'), 'dim composer cursor')

  // Ctrl-W is Neovim's: the window prefix reaches it instead of closing the
  // column. Ctrl-D is the column key and is covered by the close below.
  tty.input.write('\u0017')
  await waitFor(() => editor.writes().includes('<C-w>'), 'nvim gets Ctrl-W')

  tty.input.write('\u001b') // normal mode: Esc leaves to the composer, column stays
  await new Promise(resolve => setTimeout(resolve, 60))
  tty.input.write('from-composer\r')
  await waitFor(() => fake.prompts.includes('from-composer'), 'the composer has the keyboard')

  tty.input.write(SHIFT_CMD_L) // Shift-Cmd-L: back into the editor without restarting it
  tty.input.write('back-in-nvim')
  await waitFor(() => editor.writes().includes('back-in-nvim'), 'keys return to nvim')

  tty.input.write(CTRL_D) // Ctrl-D closes: Neovim is clean, so it leaves at once
  await new Promise(resolve => setTimeout(resolve, 200))
  tty.input.write('\u0011') // and the client quits
  await expect(tty.run).resolves.toBe(0)
})

test('Cmd-Ctrl-[ / ] and Ctrl-Shift move the pane divider in the key direction', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-resize-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_D) // Ctrl-D opens the Neovim column with the keyboard in it
  await waitFor(() => editor.spawned(), 'editor column')
  await waitFor(() => editor.width() !== undefined, 'the pane asked for a pty width')
  const start = editor.width()!

  // The key names the boundary's direction: the leftward spellings take the rule
  // left, which gives the column on its right more room, and the rightward ones
  // take it right again. The pty follows the width and Neovim never sees the
  // sequence. Extended modifiers (Shift on a bracket, Command) reach a program
  // only through the keyboard report, so they arrive as CSI-u.
  tty.input.write('\u001b[91;13u') // Cmd-Ctrl-[ widens the column
  await waitFor(() => editor.width() === start + 2, 'Cmd-Ctrl-[ widens')
  expect(editor.writes()).not.toContain('91;13u')

  tty.input.write('\u001b[93;13u') // Cmd-Ctrl-] narrows it again
  await waitFor(() => editor.width() === start, 'Cmd-Ctrl-] narrows')

  tty.input.write('\u001b[91;6u') // Ctrl-Shift-[ widens
  await waitFor(() => editor.width() === start + 2, 'Ctrl-Shift-[ widens')
  tty.input.write('\u001b[93;6u') // Ctrl-Shift-] narrows
  await waitFor(() => editor.width() === start, 'Ctrl-Shift-] narrows')

  // The arrow pair is the one spelling every terminal reports: a plain CSI
  // sequence carrying shift+ctrl, no keyboard report needed.
  tty.input.write('\u001b[1;6D') // Ctrl-Shift-← widens
  await waitFor(() => editor.width() === start + 2, 'Ctrl-Shift-← widens')
  tty.input.write('\u001b[1;6C') // Ctrl-Shift-→ narrows
  await waitFor(() => editor.width() === start, 'Ctrl-Shift-→ narrows')

  tty.input.write(CTRL_D) // Ctrl-D closes: Neovim is clean, so it leaves at once
  await new Promise(resolve => setTimeout(resolve, 200))
  tty.input.write('\u0011') // and the client quits
  await expect(tty.run).resolves.toBe(0)
})

test('the rail divider is dragged with the pointer, and the key moves it too', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-rail-width-'))
  const fake = fakeBackend(home)
  const tty = startPtyTty(home, fake, undefined as never)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  // SGR coordinates are 1-based: a 100-column terminal draws the default rail 18
  // cells wide, so its rule is the 19th cell (index 18) and the pointer's column
  // 19 is one past it.
  const rule = 20
  const seen = (): string => plain(tty.painted())
  /**
   * Park the pointer in the conversation until the rule paints its idle glyph.
   *
   * A move that arrives while the frame is being rebuilt is dropped by the
   * renderer, so the park is repeated rather than sent once.
   */
  const settle = async (): Promise<void> => {
    const deadline = Date.now() + 1_000
    while (seen().lastIndexOf('▎') > seen().lastIndexOf('▏')) {
      if (Date.now() > deadline) throw new Error('the rail rule never went idle')
      tty.input.write(`\u001b[<35;60;3M`)
      await new Promise(resolve => setTimeout(resolve, 40))
    }
  }
  /** Whether the pointer at `column` lands on the rail's rule. */
  const onRule = async (column: number): Promise<boolean> => {
    await settle()
    const deadline = Date.now() + 600
    do {
      const mark = tty.painted().length
      tty.input.write(`\u001b[<35;${column};3M`)
      await new Promise(resolve => setTimeout(resolve, 60))
      if (plain(tty.painted().slice(mark)).includes('▎')) return true
    } while (Date.now() < deadline)
    return false
  }

  // The rail's rule used to be painted with no pointer handling at all.
  expect(await onRule(rule)).toBe(true)
  expect(await onRule(rule + 2)).toBe(false)

  // Press it, drag six cells right and let go: the rail takes the wider share and
  // the rule lands under the pointer instead of one cell short of it.
  tty.input.write(`\u001b[<0;${rule};3M`)
  tty.input.write(`\u001b[<32;${rule + 6};3M`)
  tty.input.write(`\u001b[<0;${rule + 6};3m`)
  expect(await onRule(rule + 6)).toBe(true)
  // The cell it was drawn in belongs to the rail's content now.
  expect(await onRule(rule)).toBe(false)

  // The keyboard moves the same boundary: from the composer, a step right widens
  // the rail (not the pane) and a step left takes it back.
  tty.input.write('draft')
  await waitFor(() => tty.painted().includes('draft'), 'the composer has the keyboard')
  tty.input.write('\u001b[1;6C') // Ctrl-Shift-→ moves the rule right
  expect(await onRule(rule + 8)).toBe(true)
  tty.input.write('\u001b[93;13u') // Cmd-Ctrl-] moves it once more
  expect(await onRule(rule + 10)).toBe(true)
  tty.input.write('\u001b[91;13u') // Cmd-Ctrl-[ takes it back a step
  expect(await onRule(rule + 8)).toBe(true)

  tty.input.write('\u0011') // and the client quits
  await expect(tty.run).resolves.toBe(0)
}, 20_000)

test('with the editor alone, the divider chord moves the boundary inside Neovim', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-editor-only-divider-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write(CTRL_D) // Ctrl-D: show and focus the Neovim column
  await waitFor(() => editor.spawned(), 'editor column')

  // Side by side the chord belongs to the frame: it moves the boundary between the
  // two columns and never reaches the program.
  tty.input.write('\u001b[91;13u') // Cmd-Ctrl-[
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(editor.writes()).not.toContain('<C-Left>')

  // The Neovim-only chord leaves the editor as the only column, so no frame boundary is drawn and
  // the chord has nothing to move here. It goes to Neovim, whose file tree draws
  // the one boundary still on screen, as the legacy Ctrl-Left / Ctrl-Right pair.
  // (Option-Left cannot be the tree's key: macOS takes Control-Left for switching
  // spaces, and what a terminal sends for Option-Left varies — one arrives as a
  // bare Escape and closes the tree instead of moving it.)
  tty.input.write(NEVIM_ONLY)
  await new Promise(resolve => setTimeout(resolve, 120))
  // Every spelling of the divider chord reaches the tree here, because they are
  // all the same action: Command or Shift on a bracket, or Shift on an arrow.
  const handOffs: Array<[string, string]> = [
    ['\u001b[91;13u', 'Cmd-Ctrl-[ steps the tree boundary left'],
    ['\u001b[93;13u', 'Cmd-Ctrl-] steps the tree boundary right'],
    ['\u001b[91;6u', 'Ctrl-Shift-[ steps the tree boundary left'],
    ['\u001b[93;6u', 'Ctrl-Shift-] steps the tree boundary right'],
    ['\u001b[1;6D', 'Ctrl-Shift-← steps the tree boundary left'],
    ['\u001b[1;6C', 'Ctrl-Shift-→ steps the tree boundary right'],
  ]
  for (const [key, label] of handOffs) {
    const seen = editor.writes()
    tty.input.write(key)
    await waitFor(() => editor.writes() !== seen, label)
  }
  // The hand-off is Ctrl-Left / Ctrl-Right in the editor's own language: key
  // notation for a UI column, the legacy bytes for a pty.
  const handed = editor.writes()
  expect(handed.match(/<C-Left>/g)?.length ?? 0).toBe(3)
  expect(handed.match(/<C-Right>/g)?.length ?? 0).toBe(3)

  tty.input.write('\u0011') // and the client quits, Neovim being clean
  await expect(tty.run).resolves.toBe(0)
})

test('an extended key report reaches the column as the legacy byte it stands for', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-kitty-'))
  const fake = fakeBackend(home)
  const panes = fakePanes()
  const tty = startPtyTty(home, fake, { pty: panes.module })
  const shellWrites = (): string => panes.panes[0]?.writes.join('') ?? ''
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  // The client asks the terminal for the disambiguated keyboard protocol: it is
  // the only way a macOS terminal reports a Command chord.
  expect(tty.painted()).toContain('\u001b[>1u')

  tty.input.write(CTRL_T) // Ctrl-T: the shell column opens with the keyboard in it
  await waitFor(() => panes.panes.length === 1, 'terminal column')
  tty.input.write('git status')
  await waitFor(() => shellWrites().includes('git status'), 'keys reach the shell')

  // Under the protocol the terminal reports these keys as CSI-u; the shell still
  // gets the bytes it was reading before the protocol was switched on. The
  // `Esc` key is the exception of the column's own rule, not of this projection:
  // an idle shell has nothing to cancel, so the client takes it back (below).
  tty.input.write('\u001b[99;5u') // Ctrl-C
  await waitFor(() => shellWrites().includes('\u0003'), 'Ctrl-C as its control byte')
  tty.input.write('\u001b[106;3u') // Alt-j
  await waitFor(() => shellWrites().includes('\u001bj'), 'Alt-j as escape plus j')
  expect(shellWrites()).not.toContain('[99;5u')

  tty.input.write('\u001b[27u') // Esc: the escape gesture, so the column gives it back
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  tty.input.write('from-composer\r')
  await waitFor(() => fake.prompts.includes('from-composer'), 'the composer has the keyboard')

  tty.input.write('\u0011') // and the client quits, popping the keyboard mode
  await expect(tty.run).resolves.toBe(0)
  expect(tty.painted()).toContain('\u001b[<u')
})

test('TTY mode opens the built-in terminal on Ctrl-T and swaps to Neovim on Ctrl-D', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-terminal-'))
  const fake = fakeBackend(home)
  const panes = fakePanes()
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { pty: panes.module, editor })
  const shellWrites = (): string => panes.panes[0]?.writes.join('') ?? ''
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_T) // Ctrl-T: the shell column opens with the keyboard in it
  await waitFor(() => panes.panes.length === 1, 'terminal column')
  tty.input.write('git status')
  await waitFor(() => shellWrites().includes('git status'), 'keys reach the shell')

  // An idle shell gives Esc back: the column stays and the composer takes the
  // keyboard, with the shell still painted beside it.
  tty.input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 60))
  panes.panes[0]?.emit('\r\nVISIBLE-MARKER')
  await waitFor(() => tty.painted().includes('VISIBLE-MARKER'), 'the sidebar stays painted without focus')
  tty.input.write('from-composer\r')
  await waitFor(() => fake.prompts.includes('from-composer'), 'the composer has the keyboard')

  // Shift-Cmd-L returns to the same shell; no new process is started.
  tty.input.write(SHIFT_CMD_L)
  tty.input.write('reentered')
  await waitFor(() => shellWrites().includes('reentered'), 'the shell kept its process')

  // Ctrl-D swaps the painted column to Neovim. The shell stays alive, and the
  // editor is the Host's: its keys arrive as notation, not as pty bytes.
  tty.input.write(CTRL_D)
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write('nvim-key')
  await waitFor(() => editor.writes().includes('nvim-key'), 'keys reach nvim')

  // Ctrl-T swaps back to the same shell, not a fresh one.
  tty.input.write(CTRL_T)
  tty.input.write('back-in-shell')
  await waitFor(() => shellWrites().includes('back-in-shell'), 'the shell survived the swap')
  expect(panes.panes[0]?.kills).toBe(0)
  expect(panes.panes.length).toBe(1)

  // Ctrl-T on the focused terminal hides the sidebar and keeps the shell and
  // its jobs alive.
  tty.input.write(CTRL_T)
  await new Promise(resolve => setTimeout(resolve, 80))
  panes.panes[0]?.emit('\r\nHIDDEN-MARKER')
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(tty.painted()).not.toContain('HIDDEN-MARKER')
  expect(panes.panes[0]?.kills).toBe(0)
  tty.input.write('after-hide\r')
  await waitFor(() => fake.prompts.includes('after-hide'), 'the composer has the keyboard again')

  // Shift-Cmd-L reopens the hidden column while its process is still alive.
  tty.input.write(SHIFT_CMD_L)
  tty.input.write('reopened-key')
  await waitFor(() => shellWrites().includes('reopened-key'), 'the hidden shell reopens')
  // One shell process and one editor channel: the editor never was a pty.
  expect(panes.panes.length).toBe(1)

  tty.input.write('\u001b') // leave the shell so the cleanup can reach /quit
  await new Promise(resolve => setTimeout(resolve, 60))
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Ctrl-T hides a terminal column that is painted but not focused', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-terminal-unfocused-'))
  const fake = fakeBackend(home)
  const panes = fakePanes()
  const tty = startPtyTty(home, fake, { pty: panes.module })
  const shellWrites = (): string => panes.panes[0]?.writes.join('') ?? ''
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_T) // Ctrl-T: the shell column opens with the keyboard in it
  await waitFor(() => panes.panes.length === 1, 'terminal column')
  tty.input.write('\u001b') // Esc: back to the composer, the column stays
  await new Promise(resolve => setTimeout(resolve, 60))
  tty.input.write('composer-first\r')
  await waitFor(() => fake.prompts.includes('composer-first'), 'composer focus')

  // The column is still painted, but Ctrl-T is a visibility toggle and not the
  // focus key: it hides the sidebar and leaves the shell running.
  tty.input.write(CTRL_T)
  await new Promise(resolve => setTimeout(resolve, 80))
  panes.panes[0]?.emit('\r\nUNFOCUSED-HIDDEN')
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(tty.painted()).not.toContain('UNFOCUSED-HIDDEN')
  expect(panes.panes[0]?.kills).toBe(0)

  // Shift-Cmd-L is the key that puts the keyboard back into the running column.
  tty.input.write(SHIFT_CMD_L)
  tty.input.write('reopened-unfocused')
  await waitFor(() => shellWrites().includes('reopened-unfocused'), 'the hidden shell reopens')
  tty.input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 60))
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Ctrl-D asks a painted but unfocused editor column to leave', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-editor-unfocused-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_D) // Ctrl-D: open and focus Neovim
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write('\u001b') // Esc: back to the composer, the column stays
  await new Promise(resolve => setTimeout(resolve, 60))
  tty.input.write('still-home\r')
  await waitFor(() => fake.prompts.includes('still-home'), 'composer focus')

  // No focus check: the column is painted, so the key closes it and Neovim is
  // asked to leave rather than stealing the keyboard back.
  tty.input.write(CTRL_D)
  await waitFor(() => editor.writes().includes(':qa'), 'Neovim asked to leave')
  tty.input.write('\u0011')
  await expect(tty.run).resolves.toBe(0)
})

test('Esc belongs to a full-screen program in the terminal', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-terminal-esc-'))
  const fake = fakeBackend(home)
  const panes = fakePanes()
  const tty = startPtyTty(home, fake, { pty: panes.module })
  const shellWrites = (): string => panes.panes[0]?.writes.join('') ?? ''
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_T)
  await waitFor(() => panes.panes.length === 1, 'terminal column')
  // A pager or `fzf` switches to the alternate screen and owns Esc itself.
  panes.panes[0]?.emit('\u001b[?1049h')
  await new Promise(resolve => setTimeout(resolve, 80))
  tty.input.write('\u001b')
  await waitFor(() => shellWrites().includes('\u001b'), 'the full-screen program keeps Escape')

  // Back on the normal screen, Esc is the client's again.
  panes.panes[0]?.emit('\u001b[?1049l')
  await new Promise(resolve => setTimeout(resolve, 80))
  tty.input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 60))
  tty.input.write('back-home\r')
  await waitFor(() => fake.prompts.includes('back-home'), 'Escape returned to the composer')

  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

/** A TTY client on a fake Host, with the bytes it painted collected. */
function startTty(fake: FakeBackend, columns = 100, promptLanguage?: boolean, resume: string | null = 'session-1234'): {
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
  // A test never reads the developer's own state root: the keymap plugin would
  // otherwise pick up a real `config/keybindings.json` and the assertions here
  // would depend on the machine. A test that already pointed the state root at
  // its own directory (the language tests) keeps it.
  const previousHome = process.env.HULALA_HOME
  const home = previousHome ?? mkdtempSync(join(tmpdir(), 'hulala-tty-'))
  process.env.HULALA_HOME = home
  const run = runTerminalClient({
    backend: fake.backend,
    cwd: '/workspace',
    input,
    output,
    ...(resume === null ? {} : { resume }),
    // Production holds a lone escape for a tenth of a second so a stalled frame
    // can finish its sequence; the suite's waits are shorter than that.
    escapeTimeoutMs: 20,
    ...(promptLanguage === undefined ? {} : { promptLanguage }),
  })
  // Detach even when an assertion threw, so a failure cannot leave the client's
  // repaint timer keeping the test process alive.
  cleanups.push(async () => {
    input.write('/quit\r')
    await Promise.race([run, new Promise(resolve => setTimeout(resolve, 500))])
    input.destroy()
    output.destroy()
    if (previousHome === undefined) {
      delete process.env.HULALA_HOME
      rmSync(home, { recursive: true, force: true })
    } else {
      process.env.HULALA_HOME = previousHome
    }
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
  expect(tty.painted()).toContain('Tab reasoning effort')
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

/** A Session already on the reasoning model, so the picker has levels to offer. */
function reasoningSession(fake: FakeBackend): void {
  fake.setSessions([{
    sessionId: 'session-1234',
    updatedAt: Date.now(),
    running: false,
    blank: false,
    cwd: '/workspace',
    model: { provider: 'deepseek-official', model: 'deepseek-flash' },
  }])
}

test('the footer names the thinking level and Shift-Tab cycles it', async () => {
  const fake = fakeBackend()
  reasoningSession(fake)
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  await waitFor(() => tty.painted().includes('deepseek-official/deepseek-flash • off'), 'footer level')
  tty.input.write('\u001b[Z') // Shift-Tab
  await waitFor(() => fake.efforts.length === 1, 'level change')
  expect(fake.efforts).toEqual(['low'])
  await waitFor(() => tty.painted().includes('thinking level: low'), 'level notice')
  await waitFor(() => tty.painted().includes('deepseek-official/deepseek-flash • low'), 'footer after cycle')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('the /thinking picker applies a level for the Session', async () => {
  const fake = fakeBackend()
  reasoningSession(fake)
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  tty.input.write('/thinking\r')
  await waitFor(() => plain(tty.painted()).includes('Thinking Level — deepseek-flash'), 'thinking picker')
  expect(plain(tty.painted())).toContain('The choice also becomes the default for new Sessions')
  tty.input.write('\u001b[B') // ↓ from the current `off` to `low`
  tty.input.write('\r')
  await waitFor(() => fake.efforts.length === 1, 'level applied')
  expect(fake.efforts).toEqual(['low'])
  await waitFor(() => tty.painted().includes('thinking level: low'), 'level notice')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('/thinking takes an explicit level and rejects one the model lacks', async () => {
  const fake = fakeBackend()
  reasoningSession(fake)
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  tty.input.write('/thinking max\r')
  await waitFor(() => fake.efforts.length === 1, 'level applied')
  expect(fake.efforts).toEqual(['max'])
  tty.input.write('/thinking turbo\r')
  await waitFor(() => tty.painted().includes('unknown thinking level "turbo"; available: off, low, max'), 'rejection')
  expect(fake.efforts).toEqual(['max'])
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a model selection from another client reaches the footer', async () => {
  const fake = fakeBackend()
  reasoningSession(fake)
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  fake.handlers?.onEvent({
    type: 'model/selection',
    seq: 9,
    time: Date.now(),
    data: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' },
  })
  await waitFor(() => tty.painted().includes('deepseek-official/deepseek-flash • max'), 'footer route')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('the /permission picker applies a preset to the Session after the full-access gate', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  fake.permission('workspace-write')
  await waitFor(() => tty.painted().includes('permission Workspace Write'), 'footer preset')

  tty.input.write('/permission\r')
  await waitFor(() => plain(tty.painted()).includes('Permission — Workspace Write'), 'permission picker')
  const picker = plain(tty.painted())
  expect(picker).toContain('Workspace Write')
  // The default badge sits on the row the Host reports as the default, not on
  // the cursor: the cursor is the current Session's preset.
  expect(picker).toContain('default for new Sessions')

  tty.input.write('\u001b[B') // ↓ to Full access
  tty.input.write('\r')
  await waitFor(() => plain(tty.painted()).includes('Full access also turns the approval prompts off'), 'full-access gate')
  tty.input.write('y')
  await waitFor(() => fake.permissions.length === 1, 'permission applied')
  expect(fake.permissions).toEqual(['danger-full-access'])
  expect(fake.permissionDefaults).toEqual([])
  await waitFor(() => tty.painted().includes('permission: Full access'), 'permission notice')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('the approval dialog grants full access to the Session that asked', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  const pending = fake.approve({
    toolName: 'bash',
    reason: 'escalate sandbox to workspace-write: the repo is outside the workspace',
  })
  await waitFor(() => plain(tty.painted()).includes('Tool approval'), 'approval dialog')
  // The Session-wide grant is an option in the footer, not a dim aside: a user
  // reading the choices must see it without knowing the hidden key.
  expect(plain(tty.painted())).toContain('[f] whole Session')
  expect(plain(tty.painted())).toContain('f = every later turn in this Session stops asking')
  tty.input.write('f')
  await expect(pending).resolves.toBe('allowed-once')
  // The switch names the open Session, which is this window's thread.
  expect(fake.permissionSessions).toEqual(['session-1234'])
  expect(fake.permissions).toEqual(['danger-full-access'])
  await waitFor(() => tty.painted().includes('permission: Full access · this thread stops asking'), 'full-access notice')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a replayed approval is answered with the choice the user already made', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  const first = fake.approve({
    sessionId: 'session-1234',
    callId: 'call-1',
    toolName: 'bash',
    reason: 'rm -rf /tmp/x',
  })
  await waitFor(() => plain(tty.painted()).includes('Tool approval'), 'approval dialog')
  tty.input.write('y')
  await expect(first).resolves.toBe('allowed-once')
  await waitFor(() => plain(tty.painted()).includes('approval allowed-once'), 'first outcome')
  // The transport died before the result reached the Host, so the Host replays
  // the same pending waterfall on the next generation. The client must answer
  // that replay with the choice it already took instead of asking again.
  const replayMark = tty.painted().length
  const replayed = fake.approve({
    sessionId: 'session-1234',
    callId: 'call-1',
    toolName: 'bash',
    reason: 'rm -rf /tmp/x',
  })
  await expect(replayed).resolves.toBe('allowed-once')
  await waitFor(() => plain(tty.painted()).includes('your answer was re-sent after reconnecting'), 'replay notice')
  expect(plain(tty.painted().slice(replayMark))).not.toContain('Tool approval')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('an approval whose delivery is lost says it will come back', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  const lost = new AbortController()
  const pending = fake.approve({
    sessionId: 'session-1234',
    callId: 'call-2',
    toolName: 'bash',
    reason: 'rm -rf /tmp/x',
    signal: lost.signal,
  })
  await waitFor(() => plain(tty.painted()).includes('Tool approval'), 'approval dialog')
  lost.abort()
  await expect(pending).resolves.toBe('cancelled')
  await waitFor(() => plain(tty.painted()).includes('this approval will return'), 'lost notice')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a question for a Session this window never opened is handed to the next answerer', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  // Answering this here would take the question away from the channel mounted
  // to that Session — the misrouting the pending-interaction model removes.
  await expect(fake.ask({
    sessionId: 'session-other',
    questions: [{ id: 'q1', question: 'Which database?', options: [{ label: 'Postgres' }] }],
  })).resolves.toBe('delegate')
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  expect(plain(tty.painted())).not.toContain('Which database?')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('an approval for a Session this window never opened is handed to the next answerer', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  await expect(fake.approve({
    sessionId: 'session-other',
    toolName: 'bash',
    reason: 'rm -rf /tmp/x',
  })).resolves.toBe('delegate')
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  expect(plain(tty.painted())).not.toContain('Tool approval')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a plan-review question outranks a plain one queued behind it', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  const approval = fake.approve({ toolName: 'bash', reason: 'rm -rf /tmp/x' })
  await waitFor(() => plain(tty.painted()).includes('Tool approval'), 'approval dialog')
  // Both questions arrive while the approval card owns the seat, so neither has
  // been presented: precedence decides which one takes it next.
  const plainQuestion = fake.ask({
    sessionId: 'session-1234',
    questions: [{ id: 'q1', question: 'Which database?', options: [{ label: 'Postgres' }] }],
  })
  const reviewed = fake.ask({
    sessionId: 'session-1234',
    questions: [{
      id: 'p1',
      question: 'Run this plan?',
      detail: '1. migrate\n2. restart',
      options: [{ label: 'Approve' }, { label: 'Revise' }],
      intent: { kind: 'plan-review', approve: 'Approve' },
    }],
  })
  tty.input.write('y') // allow once
  await expect(approval).resolves.toBe('allowed-once')
  await waitFor(() => plain(tty.painted()).includes('Run this plan?'), 'plan-review card')
  expect(plain(tty.painted())).not.toContain('Which database?')
  tty.input.write('\r')
  await expect(reviewed).resolves.toEqual({ answers: [{ id: 'p1', selected: ['Approve'] }] })
  // The plain question keeps its place in the queue and takes the seat after it.
  await waitFor(() => plain(tty.painted()).includes('Which database?'), 'plain question')
  tty.input.write('\r')
  await expect(plainQuestion).resolves.toEqual({ answers: [{ id: 'q1', selected: ['Postgres'] }] })
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Alt-D hands a question to another client and leaves a notice behind', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  const pending = fake.ask({
    sessionId: 'session-1234',
    questions: [{ id: 'q1', question: 'Which database?', options: [{ label: 'Postgres' }] }],
  })
  await waitFor(() => plain(tty.painted()).includes('Which database?'), 'question card')
  tty.input.write('\u001bd') // Alt-D
  await expect(pending).resolves.toBe('delegate')
  // A silent hand-off is the failure this state machine exists to remove.
  await waitFor(() => plain(tty.painted()).includes('handed to another client'), 'delegation notice')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a timed question claims the wait, parks on Esc and reopens on Alt-G', async () => {
  const fake = fakeBackend()
  fake.setWaitRemaining(30_000)
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  const pending = fake.ask({
    sessionId: 'session-1234',
    wait: { callId: 'call-1', timed: true },
    questions: [{ id: 'q1', question: 'Which database?', options: [{ label: 'Postgres' }] }],
  })
  await waitFor(() => plain(tty.painted()).includes('Which database?'), 'question card')
  // The client must hold the Host's foreground wait before it starts counting.
  expect(fake.waits()).toEqual([{ sessionId: 'session-1234', callId: 'call-1' }])
  await waitFor(() => plain(tty.painted()).includes('30s left'), 'countdown')
  tty.input.write('\u001b') // Esc parks a timed card
  await waitFor(() => plain(tty.painted()).includes('question parked'), 'park notice')
  await waitFor(() => plain(tty.painted()).includes('1 parked'), 'footer count')
  tty.input.write('\u001bg') // Alt-G brings it back
  await waitFor(() => plain(tty.painted()).includes('Which database?'), 'reopened card')
  // The input tokenizer holds an escape sequence for `escapeTimeoutMs`; typing
  // into the chord it just parsed is a test artefact, not a user gesture.
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(fake.waits()).toHaveLength(1) // reopening must not claim the wait twice
  tty.input.write('\r')
  await expect(pending).resolves.toEqual({ answers: [{ id: 'q1', selected: ['Postgres'] }] })
  // Answering releases the claim, so the Host's own timer is not left stopped.
  await waitFor(() => fake.disposed() > 0, 'claim released')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a Computer-Use approval intent renders as a permission card', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  const pending = fake.ask({
    sessionId: 'session-1234',
    questions: [{
      id: 'q1',
      question: 'Allow the camera?',
      detail: 'example.com asks for the camera',
      options: [{ label: 'Allow' }, { label: 'Reject' }, { label: 'Always' }],
      intent: {
        kind: 'approval',
        approve: 'Allow',
        reject: 'Reject',
        always: 'Always',
        subject: { name: 'example.com' },
      },
    }],
  })
  await waitFor(() => plain(tty.painted()).includes('Approval needed'), 'permission card')
  const card = plain(tty.painted())
  // The subject is who asks; the caller's question is the heading.
  expect(card).toContain('example.com')
  expect(card).toContain('Allow the camera?')
  // Fixed actions are marked, and there is no free-text row on this card.
  expect(card).toContain('✓ Allow')
  expect(card).toContain('✕ Reject')
  expect(card).toContain('∞ Always')
  expect(card).not.toContain('Other (type your answer)')
  tty.input.write('\r')
  await expect(pending).resolves.toEqual({ answers: [{ id: 'q1', selected: ['Allow'] }] })
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

/** One `continued` row of the `userQuestions` projection, as the Host writes it. */
const continuedRow = (callId = 'call-1'): TerminalPendingQuestion => ({
  callId,
  state: 'continued',
  questions: [{ id: 'q1', question: 'Which database?', options: [{ label: 'Postgres' }, { label: 'SQLite' }] }],
})

test('a continued question is parked, revealed with Alt-G and answered through the projection', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  fake.questions([continuedRow()])
  // The durable card is parked on arrival: the window already had its chance
  // to answer this call, or never saw it, and must not lose the keyboard to it.
  await waitFor(() => plain(tty.painted()).includes('1 parked'), 'parked card')
  expect(plain(tty.painted())).not.toContain('Which database?')
  tty.input.write('\u001bg') // Alt-G
  await waitFor(() => plain(tty.painted()).includes('Which database?'), 'late-answer card')
  expect(plain(tty.painted())).toContain('Waiting for an answer')
  tty.input.write('\r') // Enter confirms the highlighted option
  await waitFor(() => fake.answers().length === 1, 'late answer')
  // A late answer is a Remote call, not the waterfall's resolve: the turn has
  // moved on and the reply is steered in as a user message.
  expect(fake.answers()[0]).toEqual({
    sessionId: 'session-1234',
    callId: 'call-1',
    answers: [{ id: 'q1', selected: ['Postgres'] }],
  })
  await waitFor(() => plain(tty.painted()).includes('answer sent'), 'reply notice')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a queued user-question-reply withdraws the continued card', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  fake.questions([continuedRow()])
  await waitFor(() => plain(tty.painted()).includes('1 parked'), 'parked card')
  const mark = tty.painted().length
  // `inbox` and `userQuestions` are two projections of one reconcile. A reply
  // already queued for this call id hides the row even while it is still listed.
  fake.inbox({ steering: [], followUp: [], replies: ['call-1'] })
  await waitFor(() => tty.painted().length > mark, 'reconcile repaint')
  expect(plain(tty.painted().slice(mark))).not.toContain('1 parked')
  tty.input.write('\u001bg') // Alt-G has nothing left to reopen
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(plain(tty.painted().slice(mark))).not.toContain('Which database?')
  expect(fake.answers()).toHaveLength(0)
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('withdrawing a continued row closes its open card and frees the interaction seat', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  fake.questions([continuedRow()])
  await waitFor(() => plain(tty.painted()).includes('1 parked'), 'parked card')
  tty.input.write('\u001bg')
  await waitFor(() => plain(tty.painted()).includes('Which database?'), 'card on screen')
  const mark = tty.painted().length
  // Another client answered the call, so the row disappears. Aborting the
  // card's closer is what resolves the overlay instead of leaving `presenting`
  // true forever — the high-severity finding this covers.
  fake.questions([])
  await waitFor(() => tty.painted().length > mark, 'withdraw repaint')
  const approval = fake.approve({ toolName: 'bash', reason: 'rm -rf /tmp/x' })
  await waitFor(() => plain(tty.painted().slice(mark)).includes('Tool approval'), 'seat freed')
  tty.input.write('y') // allow once
  await expect(approval).resolves.toBe('allowed-once')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('one timed call keeps one card across the waterfall and the projection', async () => {
  const fake = fakeBackend()
  fake.setWaitRemaining(30_000)
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  const pending = fake.ask({
    sessionId: 'session-1234',
    wait: { callId: 'call-1', timed: true },
    questions: [{ id: 'q1', question: 'Which database?', options: [{ label: 'Postgres' }] }],
  })
  await waitFor(() => plain(tty.painted()).includes('Which database?'), 'foreground card')
  // DSH keys a question card by (Session, tool call): the waterfall and the
  // durable projection are two states of the *same* card, not two cards.
  const mark = tty.painted().length
  fake.questions([continuedRow()])
  await waitFor(() => tty.painted().length > mark, 'projection repaint')
  expect(fake.waits()).toHaveLength(1)
  expect(plain(tty.painted().slice(mark))).not.toContain('1 parked')
  tty.input.write('\r')
  await expect(pending).resolves.toEqual({ answers: [{ id: 'q1', selected: ['Postgres'] }] })
  // Once the waterfall settles, the snapshot is replayed and the durable half
  // of the call materializes as a parked card under the same key.
  await waitFor(() => plain(tty.painted()).includes('1 parked'), 'durable card')
  expect(fake.waits()).toHaveLength(1) // no second claim
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('non-TTY approval answers full access by switching the open Session', async () => {
  const fake = fakeBackend()
  const input = new PassThrough()
  const output = new PassThrough()
  let text = ''
  output.on('data', chunk => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
  await waitFor(() => text.includes('history answer'), 'history')
  const pending = fake.approve({ toolName: 'bash', reason: 'escalate sandbox to workspace-write' })
  await waitFor(() => text.includes('[approval] bash'), 'approval prompt')
  expect(text).toContain('f = full access')
  input.write('f\n')
  await expect(pending).resolves.toBe('allowed-once')
  expect(fake.permissions).toEqual(['danger-full-access'])
  expect(fake.permissionSessions).toEqual(['session-1234'])
  input.write('/quit\n')
  await expect(run).resolves.toBe(0)
})

test('Ctrl-S applies the highlighted preset and stores it as the Session default', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  fake.permission('workspace-write')
  await waitFor(() => tty.painted().includes('permission Workspace Write'), 'footer preset')

  tty.input.write('/permission\r')
  await waitFor(() => plain(tty.painted()).includes('Permission — Workspace Write'), 'permission picker')
  tty.input.write('\u0013') // Ctrl-S
  await waitFor(() => fake.permissionDefaults.length === 1, 'default written')
  expect(fake.permissions).toEqual(['workspace-write'])
  expect(fake.permissionDefaults).toEqual(['workspace-write'])
  await waitFor(() => tty.painted().includes('permission: Workspace Write · default for new Sessions'), 'notice')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('/permission default <preset> writes the default without switching the Session', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')

  tty.input.write('/permission default read-only\r')
  await waitFor(() => fake.permissionDefaults.length === 1, 'default written')
  expect(fake.permissionDefaults).toEqual(['read-only'])
  expect(fake.permissions).toEqual([])
  await waitFor(() => tty.painted().includes('default permission for new Sessions: Read Only'), 'notice')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('/permission takes a preset directly and rejects one the Host does not offer', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')

  tty.input.write('/permission read-only\r')
  await waitFor(() => fake.permissions.length === 1, 'permission applied')
  expect(fake.permissions).toEqual(['read-only'])

  tty.input.write('/permission turbo\r')
  await waitFor(() => tty.painted().includes('unknown permission preset "turbo"'), 'rejection')
  expect(fake.permissions).toEqual(['read-only'])
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a permission change from another client reaches the footer', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  fake.permission('danger-full-access')
  await waitFor(() => tty.painted().includes('permission Full access'), 'footer preset')
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
function fakeEditor(options: { clean: boolean; exitDelayMs?: number; anyCwd?: boolean }): {
  face: HostEditor
  writes(): string
  spawned(): boolean
  saves(): number
  /** Columns of the last grid the pane asked Neovim for. */
  width(): number | undefined
  /** Send one Neovim UI event group, e.g. a mode change that asks for a bar caret. */
  emit(...group: [string, ...unknown[]]): void
  /** Report that Neovim is gone, as the Host's exit frame would. */
  emitExit(code: number): void
} {
  const writes: string[] = []
  let clean = options.clean
  let spawned = false
  let saves = 0
  let cols: number | undefined
  let deliver: ((chunk: Uint8Array) => void) | undefined
  let exited: ((event: { code: number | null }) => void) | undefined
  let closed = false

  const sendEvent = (...group: [string, ...unknown[]]): void => {
    deliver?.(encodeMsgpack([2, 'redraw', [[group[0] as Msgpack, group.slice(1) as Msgpack[]]]]))
  }
  const exit = (code: number): void => {
    if (closed) return
    closed = true
    exited?.({ code })
  }

  const channel: EditorChannel = {
    async open(request) {
      // The Host refuses a directory that does not exist, which is what the
      // client turns into "the column cannot start". A remote Host's directory is
      // not this machine's, so `anyCwd` stands in for that side of the link.
      if (options.anyCwd !== true && !existsSync(request.cwd)) throw new Error(`not a directory: ${request.cwd}`)
      spawned = true
      cols = request.cols
      return undefined
    },
    onData(handler) { deliver = handler },
    onProblem() {},
    onExit(handler) { exited = handler },
    onReconnect() {},
    onTree() {},
    send(chunk) {
      for (const value of decodeMsgpack(chunk).values) {
        if (!Array.isArray(value)) continue
        const [, , method, params] = value as [number, number, string, unknown[]]
        if (method === 'nvim_ui_try_resize') { cols = Number(params?.[0]); continue }
        if (method !== 'nvim_input' && method !== 'nvim_paste') continue
        const text = String(params?.[0] ?? '')
        writes.push(text)
        if (text.includes('wall') || text.includes('write!')) { clean = true; saves += 1 }
        const leave = text.includes(':qa!') || (text.includes(':qa') && clean)
        if (leave) {
          const delay = options.exitDelayMs ?? 0
          if (delay === 0) queueMicrotask(() => exit(0))
          else setTimeout(() => exit(0), delay)
        }
      }
    },
    close() { closed = true },
  }

  return {
    face: { connect: () => channel },
    writes: () => writes.join(''),
    spawned: () => spawned,
    saves: () => saves,
    width: () => cols,
    emit: sendEvent,
    emitExit: exit,
  }
}

/** A pty backend whose children are the test: no shell or editor really starts. */
function fakePanes(): {
  module: PtyModule
  panes: Array<{ readonly writes: string[]; emit(data: string): void; kills: number }>
} {
  const panes: Array<{ readonly writes: string[]; emit(data: string): void; kills: number }> = []
  const module: PtyModule = {
    spawn() {
      let deliver: ((data: string) => void) | undefined
      let exit: ((event: { exitCode: number }) => void) | undefined
      const pane = {
        writes: [] as string[],
        kills: 0,
        emit(data: string): void { deliver?.(data) },
      }
      panes.push(pane)
      return {
        pid: panes.length,
        onData(handler: { (data: string): void }) { deliver = handler },
        onExit(handler: { (event: { exitCode: number }): void }) { exit = handler },
        write(data: string) {
          pane.writes.push(data)
          // The editor is clean in these tests, so `:qa` leaves at once. The
          // shell never receives it (only `panes.leave()` writes it).
          if (data.includes(':qa')) queueMicrotask(() => exit?.({ exitCode: 0 }))
        },
        resize() {},
        kill() { pane.kills += 1 },
      }
    },
  }
  return { module, panes }
}

/** A TTY client whose sidebar runs the given pty module. */
function startPtyTty(
  home: string,
  fake: FakeBackend,
  options: { editor?: { face: HostEditor }; pty?: PtyModule; remote?: string } = {},
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
  const run = runTerminalClient({
    backend: {
      ...fake.backend,
      ...(options.editor === undefined ? {} : { editor: options.editor.face }),
    },
    cwd: home,
    input,
    output,
    resume: 'session-1234',
    // The suite's Escape arrives within 60 ms; production waits a tenth of a
    // second so a stalled frame can finish the sequence it belongs to.
    escapeTimeoutMs: 20,
    ...(options.pty === undefined ? {} : { pty: options.pty }),
    ...(options.remote === undefined ? {} : { remote: options.remote }),
    // A remote tab names a machine; fixing it here keeps the suite from shelling
    // out to ssh for a title it never asserts. A local window names none, which
    // is the default and needs no injection.
    ...(options.remote === undefined ? {} : { machine: { user: 'root', host: options.remote } }),
  })
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
async function openEditorAndBlur(tty: ReturnType<typeof startPtyTty>, editor: ReturnType<typeof fakeEditor>): Promise<void> {
  tty.input.write(CTRL_D) // Ctrl-D: show and focus the Neovim column
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write('\u001b') // Esc: back to the composer, column stays
  await new Promise(resolve => setTimeout(resolve, 60))
}

test('quitting a clean editor asks nothing and leaves through :qa', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-gate-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  await openEditorAndBlur(tty, editor)
  tty.input.write('\u0011') // Ctrl-Q is the exit key
  await expect(tty.run).resolves.toBe(0)
  expect(tty.painted()).not.toContain('There are unsaved files')
  expect(editor.writes()).toContain(':qa')
})

test('quitting an editor Neovim will not leave asks, and Escape keeps the client', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-gate-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: false })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  await openEditorAndBlur(tty, editor)

  tty.input.write('\u0011')
  await waitFor(() => tty.painted().includes('There are unsaved files'), 'confirm dialog')
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
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  await openEditorAndBlur(tty, editor)

  tty.input.write('\u0011')
  await waitFor(() => tty.painted().includes('There are unsaved files'), 'confirm dialog')
  tty.input.write('s') // save all, then Neovim leaves on its own
  await expect(tty.run).resolves.toBe(0)
  expect(editor.saves()).toBe(1)
  expect(editor.writes()).toContain('wall')
})

test('/update installs the downloaded release and restarts into it', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  // This process is a source checkout, not the release the developer happens to
  // have installed: an inherited launcher root would make `/update` swap to it
  // instead of asking for the confirmation this test is about.
  const previousRoot = process.env.HULALA_INSTALL_ROOT
  delete process.env.HULALA_INSTALL_ROOT
  cleanups.push(() => {
    if (previousRoot === undefined) delete process.env.HULALA_INSTALL_ROOT
    else process.env.HULALA_INSTALL_ROOT = previousRoot
  })
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
  // The consequences are named before the machine goes down; Enter accepts.
  await waitFor(() => text.includes('Update and restart'), 'update confirmation')
  input.write('\r')
  await expect(run).resolves.toBe(0)
  expect(applied).toBe(1)
  expect(restarted).toBe('session-1234')
})

test('/restart reopens the window on the installed release without installing', async () => {
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
    applyUpdate: async () => { applied += 1; return { ok: true, message: 'unused' } },
    restartClient: resume => { restarted = resume },
  })
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  input.write('/restart\r')
  await expect(run).resolves.toBe(0)
  expect(applied).toBe(0)
  expect(restarted).toBe('session-1234')
})

test('a restart releases stdin before the successor takes the terminal', async () => {
  // The successor inherits the same tty. If this process is still reading it,
  // every read is a race: one side gets `ESC`, the other `[D`. Releasing the
  // listener is not enough — a resumed stream keeps draining and discarding the
  // bytes, so it has to be paused too.
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  cleanups.push(() => { input.destroy(); output.destroy() })
  let dataListeners = -1
  let paused = false
  const run = runTerminalClient({
    backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234',
    applyUpdate: async () => ({ ok: true, message: 'unused' }),
    restartClient: () => {
      dataListeners = input.listenerCount('data')
      paused = input.isPaused()
    },
  })
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  input.write('/restart\r')
  await expect(run).resolves.toBe(0)
  expect(dataListeners).toBe(0)
  expect(paused).toBe(true)
})

test('/update switches a stale window onto the installed release without installing', async () => {
  // Another terminal already installed 9.9.9; this process still runs an older
  // one, so `/update` is a swap, not a download.
  const home = mkdtempSync(join(tmpdir(), 'hulala-stale-'))
  const dataRoot = join(home, 'hulala')
  const root = join(dataRoot, 'runtime', 'tui')
  mkdirSync(join(dataRoot, 'bin'), { recursive: true })
  mkdirSync(join(root, 'versions', '9.9.9-e4dce47'), { recursive: true })
  writeFileSync(join(dataRoot, 'bin', 'hulala'), `#!/bin/sh\n# hulala-launcher {"format":1,"root":${JSON.stringify(root)},"state":${JSON.stringify(dataRoot)}}\n`)
  writeFileSync(join(root, 'active.json'), JSON.stringify({
    format: 1,
    current: { id: '9.9.9-e4dce47', version: '9.9.9', manifestSha256: 'a'.repeat(64), dataFormat: 1 },
  }))
  const previousHome = process.env.HULALA_HOME
  const previousRoot = process.env.HULALA_INSTALL_ROOT
  process.env.HULALA_HOME = dataRoot
  process.env.HULALA_INSTALL_ROOT = root
  cleanups.push(() => {
    if (previousHome === undefined) delete process.env.HULALA_HOME
    else process.env.HULALA_HOME = previousHome
    if (previousRoot === undefined) delete process.env.HULALA_INSTALL_ROOT
    else process.env.HULALA_INSTALL_ROOT = previousRoot
  })

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
    updateCheck: async () => ({ currentVersion: '0.1.15', latestVersion: '9.9.9', downloaded: true }),
    applyUpdate: async () => { applied += 1; return { ok: true, message: 'unused' } },
    restartClient: resume => { restarted = resume },
  })
  await waitFor(() => text.includes('/update'), 'downloaded update notice')
  input.write('/update\r')
  await expect(run).resolves.toBe(0)
  expect(applied).toBe(0)
  expect(restarted).toBe('session-1234')
})

test('/update reports a failed install and keeps the client running', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  // As above: the confirmation path belongs to a source checkout, not to the
  // release installed in the developer's shell.
  const previousRoot = process.env.HULALA_INSTALL_ROOT
  delete process.env.HULALA_INSTALL_ROOT
  cleanups.push(() => {
    if (previousRoot === undefined) delete process.env.HULALA_INSTALL_ROOT
    else process.env.HULALA_INSTALL_ROOT = previousRoot
  })
  let restarted = false
  const run = runTerminalClient({
    backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234',
    updateCheck: async () => ({ currentVersion: '0.1.15', latestVersion: '0.1.16', downloaded: true }),
    applyUpdate: async () => ({ ok: false, message: 'Downloaded archive SHA-256 mismatch' }),
    restartClient: () => { restarted = true },
  })
  await waitFor(() => text.includes('/update'), 'downloaded update notice')
  input.write('/update\r')
  await waitFor(() => text.includes('Update and restart'), 'update confirmation')
  input.write('\r')
  await waitFor(() => text.includes('SHA-256 mismatch'), 'failure notice')
  expect(restarted).toBe(false)
  input.write('still-here\r')
  await waitFor(() => fake.prompts.includes('still-here'), 'the client kept running')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('the composer takes input again after Ctrl-D closes the editor column', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-reclose-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_D) // Ctrl-D: open and focus the Neovim column
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write(CTRL_D) // Ctrl-D: close it again (Neovim is clean)
  await new Promise(resolve => setTimeout(resolve, 300))

  tty.input.write('after-close\r')
  await waitFor(() => fake.prompts.includes('after-close'), 'the composer has the keyboard again')
  tty.input.write('\u0011')
  await expect(tty.run).resolves.toBe(0)
})

test('the composer takes input after discarding an unsaved buffer on close', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-discard-close-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: false })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_D)
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write(CTRL_D) // close: Neovim refuses, so the dialog appears
  await waitFor(() => tty.painted().includes('There are unsaved files'), 'confirm dialog')
  tty.input.write('d') // discard
  await new Promise(resolve => setTimeout(resolve, 300))

  tty.input.write('after-discard\r')
  await waitFor(() => fake.prompts.includes('after-discard'), 'the composer has the keyboard again')
  tty.input.write('\u0011')
  await expect(tty.run).resolves.toBe(0)
})

test('a dialog left open when the editor exits does not disable the keyboard', async () => {
  // Neovim taking longer than the grace period and then leaving on its own is
  // the case that used to strand the client: the dialog stayed open, so every
  // keystroke was dropped while the composer looked focused.
  const home = mkdtempSync(join(tmpdir(), 'hulala-slow-close-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: false })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write(CTRL_D)
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write(CTRL_D) // close: Neovim refuses, so the dialog appears
  await waitFor(() => tty.painted().includes('There are unsaved files'), 'confirm dialog')
  // The Host reports the exit while the dialog is still up.
  editor.emitExit(0)
  await new Promise(resolve => setTimeout(resolve, 300))

  tty.input.write('after-slow-close\r')
  await waitFor(() => fake.prompts.includes('after-slow-close'), 'the composer takes input again')
  tty.input.write('\u0011')
  await expect(tty.run).resolves.toBe(0)
})

test('a slow but committed quit is not mistaken for unsaved work', async () => {
  // The exit frame is the answer to "is this quitting or refusing?"; a quit that
  // takes a while to finish still exits without a dialog.
  const home = mkdtempSync(join(tmpdir(), 'hulala-leave-marker-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true, exitDelayMs: 1_000 })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write(CTRL_D)
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write(CTRL_D) // close: committed, just slow
  await new Promise(resolve => setTimeout(resolve, 2_600))
  expect(tty.painted()).not.toContain('There are unsaved files')

  tty.input.write('after-slow-quit\r')
  await waitFor(() => fake.prompts.includes('after-slow-quit'), 'the composer takes input again')
  tty.input.write('\u0011')
  await expect(tty.run).resolves.toBe(0)
})

function languageHome(): { home: string; restore(): void } {
  const home = mkdtempSync(join(tmpdir(), 'hulala-language-client-'))
  const previousHome = process.env.HULALA_HOME
  const previousLang = process.env.HULALA_LANG
  process.env.HULALA_HOME = home
  delete process.env.HULALA_LANG
  return {
    home,
    restore: () => {
      if (previousHome === undefined) delete process.env.HULALA_HOME
      else process.env.HULALA_HOME = previousHome
      if (previousLang === undefined) delete process.env.HULALA_LANG
      else process.env.HULALA_LANG = previousLang
      rmSync(home, { recursive: true, force: true })
    },
  }
}

function languageFile(home: string): string {
  return join(home, 'config', 'client.json')
}

/** The saved language, or undefined when none was written. The file holds other
 * preferences too (the changelog marker), so the whole document is not pinned. */
function savedLanguage(home: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(languageFile(home), 'utf8')) as { language?: string }).language
  } catch {
    return undefined
  }
}

test('first launch asks once, saves the choice, and the next launch is already Chinese', async () => {
  const state = languageHome()
  try {
    const fake = fakeBackend()
    const first = startTty(fake, 100, true)
    await waitFor(() => plain(first.painted()).includes('Choose a language / 选择语言'), 'language picker')
    expect(plain(first.painted())).toContain('English')
    expect(plain(first.painted())).toContain('中文（简体）')
    expect(plain(first.painted())).toContain('You can change this later with /language')

    first.input.write('2') // 中文（简体）
    await waitFor(() => plain(first.painted()).includes('搜索'), 'Chinese interface')
    expect(savedLanguage(state.home)).toBe('zh-CN')
    // Switching the interface never rewrites what the Host already said.
    expect(plain(first.painted())).toContain('history answer')
    first.input.write('/quit\r')
    await expect(first.run).resolves.toBe(0)

    const second = startTty(fakeBackend(), 100, true)
    await waitFor(() => plain(second.painted()).includes('history answer'), 'second launch')
    expect(plain(second.painted())).not.toContain('Choose a language')
    expect(plain(second.painted())).toContain('搜索')
    second.input.write('/quit\r')
    await expect(second.run).resolves.toBe(0)
  } finally {
    state.restore()
  }
})

test('Escape leaves the language unset, so the next launch asks again', async () => {
  const state = languageHome()
  try {
    const first = startTty(fakeBackend(), 100, true)
    await waitFor(() => plain(first.painted()).includes('Choose a language / 选择语言'), 'language picker')
    first.input.write('\u001b')
    // A lone Escape is also the prefix of an escape sequence: give pi-tui its
    // disambiguation window before the next line reaches the composer.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(savedLanguage(state.home)).toBeUndefined()
    expect(plain(first.painted())).toContain('search')
    first.input.write('/quit\r')
    await expect(first.run).resolves.toBe(0)

    const second = startTty(fakeBackend(), 100, true)
    await waitFor(() => plain(second.painted()).includes('Choose a language / 选择语言'), 'picker again')
    second.input.write('\u001b')
    await new Promise(resolve => setTimeout(resolve, 100))
    second.input.write('/quit\r')
    await expect(second.run).resolves.toBe(0)
  } finally {
    state.restore()
  }
})

test('HULALA_LANG skips the picker and is never written', async () => {
  const state = languageHome()
  const previousLang = process.env.HULALA_LANG
  process.env.HULALA_LANG = 'zh-CN'
  try {
    const tty = startTty(fakeBackend(), 100, true)
    await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
    expect(plain(tty.painted())).not.toContain('Choose a language')
    expect(plain(tty.painted())).toContain('搜索')
    // The environment overrides without becoming a saved choice.
    expect(savedLanguage(state.home)).toBeUndefined()
    tty.input.write('/quit\r')
    await expect(tty.run).resolves.toBe(0)
  } finally {
    if (previousLang === undefined) delete process.env.HULALA_LANG
    else process.env.HULALA_LANG = previousLang
    state.restore()
  }
})

test('a bad HULALA_LANG is reported and still asks', async () => {
  const state = languageHome()
  process.env.HULALA_LANG = 'klingon'
  try {
    const tty = startTty(fakeBackend(), 100, true)
    await waitFor(() => plain(tty.painted()).includes('Choose a language / 选择语言'), 'language picker')
    expect(plain(tty.painted())).toContain('HULALA_LANG=klingon')
    expect(savedLanguage(state.home)).toBeUndefined()
    tty.input.write('\u001b')
    await new Promise(resolve => setTimeout(resolve, 100))
    tty.input.write('/quit\r')
    await expect(tty.run).resolves.toBe(0)
  } finally {
    state.restore()
  }
})

test('a broken client.json asks again and says why', async () => {
  const state = languageHome()
  mkdirSync(join(state.home, 'config'), { recursive: true })
  writeFileSync(languageFile(state.home), '{"language":')
  try {
    const tty = startTty(fakeBackend(), 100, true)
    await waitFor(() => plain(tty.painted()).includes('The saved language could not be read'), 'language problem')
    expect(plain(tty.painted())).toContain('Choose a language / 选择语言')
    tty.input.write('1') // English
    await waitFor(() => savedLanguage(state.home) === 'en', 'repaired file')
    tty.input.write('/quit\r')
    await expect(tty.run).resolves.toBe(0)
  } finally {
    state.restore()
  }
})

test('/language switches and persists immediately, and rejects an unknown value', async () => {
  const state = languageHome()
  mkdirSync(join(state.home, 'config'), { recursive: true })
  writeFileSync(languageFile(state.home), '{"language":"zh-CN"}\n')
  try {
    const tty = startTty(fakeBackend(), 100, true)
    await waitFor(() => plain(tty.painted()).includes('搜索'), 'Chinese interface')
    tty.input.write('/language en\r')
    await waitFor(() => plain(tty.painted()).includes('Interface language set to English.'), 'language notice')
    await waitFor(() => plain(tty.painted()).includes('search'), 'English rail')
    expect(savedLanguage(state.home)).toBe('en')

    tty.input.write('/language xx\r')
    await waitFor(() => plain(tty.painted()).includes('unsupported language "xx"'), 'unsupported notice')
    expect(savedLanguage(state.home)).toBe('en')
    expect(plain(tty.painted())).toContain('history answer')
    tty.input.write('/quit\r')
    await expect(tty.run).resolves.toBe(0)
  } finally {
    state.restore()
  }
})

test('/language without an argument opens the picker on the current language', async () => {
  const state = languageHome()
  mkdirSync(join(state.home, 'config'), { recursive: true })
  writeFileSync(languageFile(state.home), '{"language":"en"}\n')
  try {
    const tty = startTty(fakeBackend(), 100, true)
    await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
    expect(plain(tty.painted())).not.toContain('Choose a language')
    tty.input.write('/language\r')
    await waitFor(() => plain(tty.painted()).includes('Choose a language / 选择语言'), 'picker from command')
    expect(plain(tty.painted())).toContain('› English')
    tty.input.write('\u001b')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(savedLanguage(state.home)).toBe('en')
    tty.input.write('/quit\r')
    await expect(tty.run).resolves.toBe(0)
  } finally {
    state.restore()
  }
})

test('plain mode uses the saved language without asking or writing', async () => {
  const state = languageHome()
  mkdirSync(join(state.home, 'config'), { recursive: true })
  writeFileSync(languageFile(state.home), '{"language":"zh-CN"}\n')
  try {
    const input = new PassThrough()
    const output = new PassThrough()
    let text = ''
    output.on('data', chunk => { text += String(chunk) })
    cleanups.push(() => { input.destroy(); output.destroy() })
    const fake = fakeBackend()
    const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
    await waitFor(() => text.includes('会话 session-1234'), 'Chinese plain session line')
    expect(text).not.toContain('Choose a language')
    expect(JSON.parse(readFileSync(languageFile(state.home), 'utf8'))).toEqual({ language: 'zh-CN' })
    // A word the registry does not know is a prompt here too, not an error.
    input.write('/nope\n')
    await waitFor(() => fake.prompts.includes('/nope'), 'the unknown word became a prompt')
    expect(text).not.toContain('未知命令')
    input.write('/quit\n')
    await expect(run).resolves.toBe(0)
  } finally {
    state.restore()
  }
})

test('Ctrl-Shift-I leaves only Neovim, and the second press restores the frame', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-editor-only-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  tty.input.write(NEVIM_ONLY)
  await waitFor(() => editor.spawned(), 'editor column')
  // The rail and the transcript are both gone: Neovim is the only column left.
  const focused = tty.painted().length
  await new Promise(resolve => setTimeout(resolve, 120))
  const after = plain(tty.painted().slice(focused))
  expect(after).not.toContain('+ new session')
  expect(plain(tty.painted().slice(focused))).not.toContain('history answer')
  // A second press restores the layout from before, its rail included.
  tty.input.write(NEVIM_ONLY)
  await waitFor(() => plain(tty.painted().slice(focused)).includes('+ new session'), 'rail restored')
  await waitFor(() => plain(tty.painted().slice(focused)).includes('history answer'), 'conversation restored')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Ctrl-Shift-I reports a column that cannot start instead of blanking the frame', async () => {
  // A directory that does not exist, so Neovim never registers a column. The
  // mode must leave the frame exactly as it was: the rail is still painted and
  // the failure names the column.
  const fake = fakeBackend('/hulala-missing-column-dir')
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/hulala-missing-column-dir', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
  await waitFor(() => plain(text).includes('history answer'), 'transcript')
  input.write(NEVIM_ONLY)
  await waitFor(() => plain(text).includes('editor unavailable'), 'editor column')
  expect(plain(text)).toContain('+ new session')
  expect(plain(text)).toContain('history answer')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('Shift-Cmd-K lists commands with their shortcuts and runs one on Enter', async () => {
  const tty = startTty(fakeBackend())
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  const mark = tty.painted().length
  tty.input.write(SHIFT_CMD_K)
  await waitFor(() => plain(tty.painted().slice(mark)).includes('/sessions'), 'palette rows')
  // The window is height-bounded, so a command below the first page is reached
  // by typing what the reader remembers rather than by scrolling past headings.
  tty.input.write('editor')
  await waitFor(() => plain(tty.painted().slice(mark)).includes('/editor'), 'filtered editor')
  const palette = plain(tty.painted().slice(mark))
  expect(palette).toContain('Ctrl-D')
  expect(palette).toContain('open or close the nvim column')
  tty.input.write('\u0015') // Ctrl-U: back to the whole list
  tty.input.write('thinking')
  await waitFor(() => plain(tty.painted().slice(mark)).includes('/thinking'), 'filtered thinking')
  expect(plain(tty.painted().slice(mark))).toContain('Shift-Tab')
  // Typing filters, and Enter runs the highlighted command without the composer.
  tty.input.write('\u0015')
  tty.input.write('status')
  await waitFor(() => plain(tty.painted().slice(mark)).includes('/status'), 'filtered')
  tty.input.write('\r')
  await waitFor(() => plain(tty.painted().slice(mark)).includes('hulala  v'), '/status ran')
  tty.input.write('\u0011')
  await expect(tty.run).resolves.toBe(0)
})

test('the palette runs the highlighted row, not the first one', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  tty.input.write(SHIFT_CMD_K)
  await waitFor(() => plain(tty.painted()).includes('/sessions'), 'palette')
  // The rows are grouped by kind, so the second row is /new even though /help
  // comes first in the catalog: the cursor and the rows must share one order.
  tty.input.write('\u001b[B')
  tty.input.write('\r')
  await waitFor(() => fake.created.length === 1, 'new Session')
  tty.input.write('\u0011')
  await expect(tty.run).resolves.toBe(0)
})

test('the palette opens with the conversation put away, and /chat brings it back', async () => {
  const tty = startTty(fakeBackend())
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  const mark = tty.painted().length
  // `/chat` is the fallback for a terminal that cannot deliver Shift-Cmd-C.
  tty.input.write('/chat\r')
  await waitFor(() => !plain(tty.painted().slice(mark)).includes('history answer'), 'conversation hidden')
  // With no composer on screen the palette is the only way back to a command.
  tty.input.write(SHIFT_CMD_K)
  await waitFor(() => plain(tty.painted().slice(mark)).includes('Commands'), 'palette without a composer')
  tty.input.write('chat')
  await waitFor(() => plain(tty.painted().slice(mark)).includes('/chat'), 'filtered to /chat')
  tty.input.write('\r')
  await waitFor(() => plain(tty.painted().slice(mark)).includes('history answer'), 'conversation restored')
  tty.input.write('\u0011')
  await expect(tty.run).resolves.toBe(0)
})

test('/rail and /nvim are the fallbacks for the two layout chords', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-fallbacks-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => plain(tty.painted()).includes('+ new session'), 'rail')
  const mark = tty.painted().length
  tty.input.write('/rail\r')
  await waitFor(() => !plain(tty.painted().slice(mark)).includes('+ new session'), 'rail hidden')
  tty.input.write('/nvim\r')
  await waitFor(() => editor.spawned(), 'editor column')
  await waitFor(() => !plain(tty.painted().slice(mark)).includes('history answer'), 'conversation hidden')
  tty.input.write('\u0011') // Ctrl-Q is the exit key
  await expect(tty.run).resolves.toBe(0)
})

test('keybindings.json rebinds a chord, and /keys reports what it ignored', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-keymap-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  mkdirSync(join(home, 'config'), { recursive: true })
  writeFileSync(join(home, 'config', 'keybindings.json'), JSON.stringify({
    'panel.editor': ['ctrl+f'],
    'panel.contour': ['ctrl+x'],
  }))
  const tty = startPtyTty(home, fake, { editor })
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  // Ctrl-F used to belong to Neovim's paging; the file gave it to the column.
  tty.input.write('\u0006')
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write('\u0006')
  await waitFor(() => editor.writes().includes(':qa'), 'editor asked to leave')
  tty.input.write('/keys\r')
  await waitFor(() => plain(tty.painted()).includes('unknown action "panel.contour"'), 'problem reported')
  await waitFor(() => plain(tty.painted()).includes('key bindings reloaded'), 'the table is printed')
  // `/keys` re-reads the file, so a rebind takes effect without a restart.
  writeFileSync(join(home, 'config', 'keybindings.json'), JSON.stringify({ 'panel.rail': ['ctrl+y'] }))
  tty.input.write('/keys\r')
  await waitFor(() => plain(tty.painted()).includes('Ctrl-Y'), 'reloaded table')
  const mark = tty.painted().length
  tty.input.write('\u0019') // Ctrl-Y: the rail, by the file's leave
  await waitFor(() => !plain(tty.painted().slice(mark)).includes('+ new session'), 'reloaded key acts')
  tty.input.write('\u0011')
  await expect(tty.run).resolves.toBe(0)
})

test('a mouse report split by the input timeout is not typed into the column', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-mouse-'))
  const fake = fakeBackend(home)
  const panes = fakePanes()
  const tty = startPtyTty(home, fake, { pty: panes.module })
  const shellWrites = (): string => panes.panes[0]?.writes.join('') ?? ''
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_T) // Ctrl-T: the shell column opens with the keyboard in it
  await waitFor(() => panes.panes.length === 1, 'terminal column')
  const mark = shellWrites().length

  // The terminal tracks every pointer movement, so reports are a flood. One
  // split across the sequence buffer's 50 ms window used to arrive as a head and
  // then as plain characters; a column with the keyboard typed both into the pty,
  // where the shell printed `35;67;18M` on its input line.
  tty.input.write('\u001b[<35;6')
  await new Promise(resolve => setTimeout(resolve, 120))
  tty.input.write('7;18M')
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(shellWrites().slice(mark)).toBe('')

  // A whole report is still consumed as a click rather than delivered to the pty.
  tty.input.write('\u001b[<0;52;29M')
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(shellWrites().slice(mark)).toBe('')

  // The swallowed tail never eats what the reader types next.
  tty.input.write('ls\r')
  await waitFor(() => shellWrites().includes('ls\r'), 'keys still reach the shell')

  tty.input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 60))
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
}, 20_000)

test('a pointer press moves the keyboard to the panel it lands in', async () => {
  // The fade is a colour attribute, so this test pins the colour capability it
  // reads instead of depending on the machine's NO_COLOR/TERM.
  const previousNoColor = process.env.NO_COLOR
  const previousTerm = process.env.TERM
  delete process.env.NO_COLOR
  process.env.TERM = 'xterm-256color'
  cleanups.push(() => {
    if (previousNoColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = previousNoColor
    if (previousTerm === undefined) delete process.env.TERM
    else process.env.TERM = previousTerm
  })
  const home = mkdtempSync(join(tmpdir(), 'hulala-mouse-focus-'))
  const fake = fakeBackend(home)
  const panes = fakePanes()
  const tty = startPtyTty(home, fake, { pty: panes.module })
  const shellWrites = (): string => panes.panes[0]?.writes.join('') ?? ''
  /** One left-button press and release on the same cell: a click, not a drag. */
  const click = async (column: number, row: number): Promise<void> => {
    tty.input.write(`\u001b[<0;${column};${row}M`)
    await new Promise(resolve => setTimeout(resolve, 40))
    tty.input.write(`\u001b[<0;${column};${row}m`)
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_T) // Ctrl-T: the terminal column opens with the keyboard in it
  await waitFor(() => panes.panes.length === 1, 'terminal column')
  // Opening the column rebuilds the frame, and the next press needs the layout
  // that rebuild painted (pi-tui drops pointer events until then).
  await new Promise(resolve => setTimeout(resolve, 120))

  // Clicking the conversation hands the keys back without closing the column: the
  // transcript brightens again and the prompt goes to the Host, not into the
  // shell's input line.
  const fadedAt = tty.painted().length
  await click(40, 5)
  await waitFor(() => {
    const delta = tty.painted().slice(fadedAt)
    return delta.includes('history answer') && !delta.includes('\u001b[2m  history answer')
  }, 'the conversation to brighten again')
  tty.input.write('clicked the conversation\r')
  await waitFor(() => fake.prompts.includes('clicked the conversation'), 'the composer took the click')
  expect(shellWrites()).not.toContain('clicked the conversation')

  // Clicking the column hands the keys to its program, and the conversation it
  // left behind is drawn faint instead of looking like where typing goes.
  const focusedAt = tty.painted().length
  await click(90, 5)
  await waitFor(
    () => /\u001b\[2m {2}history answer/u.test(tty.painted().slice(focusedAt)),
    'the faded conversation',
  )
  tty.input.write('echo pane\r')
  await waitFor(() => shellWrites().includes('echo pane\r'), 'the pane took the click')
  expect(fake.prompts).not.toContain('echo pane')

  // Clicking the rail hands the keys to the list, where `n` creates a Session.
  await click(5, 5)
  tty.input.write('n')
  await waitFor(() => fake.created.length === 1, 'the rail took the click')

  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
}, 20_000)

test('/compact dispatches to the Host command the Session catalog offers', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')

  // The row is the Host's, not the client's: typing the first letters offers it.
  tty.input.write('/comp')
  await waitFor(() => plain(tty.painted()).includes('Compact older conversation history'), 'catalog completion')
  for (let index = 0; index < '/comp'.length; index += 1) tty.input.write('\u007f')

  tty.input.write('/compact\r')
  await waitFor(() => fake.hostCommands.length === 1, 'command dispatched')
  expect(fake.hostCommands).toEqual(['/compact'])
  // The client says nothing itself: the outcome is the Host's step row.
  expect(plain(tty.painted())).not.toContain('unknown command')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a pasted absolute path is a prompt, not an unknown command', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')

  // The exact line `Ctrl-V` leaves in the draft after storing a screenshot.
  const shot = '/tmp/hulala-pastes/paste-20261117-222027-0d97cf22.png'
  tty.input.write(`${shot}\r`)
  await waitFor(() => fake.prompts.includes(shot), 'the path reached the model')
  expect(plain(tty.painted())).not.toContain('unknown command')

  // An image reference under the question is one prompt, path line included.
  const second = '/var/folders/gy/x/T/hulala-pastes/paste-b.png'
  tty.input.write(`看一下这个截图\n${second}\r`)
  await waitFor(() => fake.prompts.includes(`看一下这个截图\n${second}`), 'text and path in one prompt')

  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a bare word the client does not know is a prompt, the way pi treats it', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')

  tty.input.write('/nope\r')
  await waitFor(() => fake.prompts.includes('/nope'), 'the unknown word reached the model')
  expect(plain(tty.painted())).not.toContain('unknown command')

  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('/压缩 is the same command as /compact and dispatches under its registered name', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')
  tty.input.write('/压缩\r')
  await waitFor(() => fake.hostCommands.length === 1, 'command dispatched')
  expect(fake.hostCommands).toEqual(['/compact'])
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a dispatched command renders as one step row: running, then its outcome', async () => {
  const fake = fakeBackend()
  const tty = startTty(fake)
  await waitFor(() => fake.handlers !== undefined, 'subscription')

  tty.input.write('/compact\r')
  await waitFor(() => fake.hostCommands.length === 1, 'command dispatched')
  fake.handlers?.onEvent({
    type: 'command/run',
    seq: 10,
    time: Date.now(),
    data: { commandId: 'c1', name: 'compact', source: { kind: 'user' } },
  })
  await waitFor(() => plain(tty.painted()).includes('Compacting context…'), 'running row')
  fake.handlers?.onEvent({
    type: 'compaction/summary',
    seq: 11,
    time: Date.now(),
    data: {
      compactionId: 'k1',
      sourceCommandId: 'c1',
      summary: [{ type: 'text', text: 'Older work, condensed.' }],
      shadowedSeqs: [3, 4, 5],
      shadowedTokenCount: 4200,
    },
  })
  fake.handlers?.onEvent({
    type: 'command/done',
    seq: 12,
    time: Date.now(),
    data: { commandId: 'c1', kind: 'success', text: 'Compacted 3 history items (~4200 tokens).' },
  })
  await waitFor(() => plain(tty.painted()).includes('Compacted 3 history items (~4200 tokens)'), 'settled row')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('the editor column opens a directory that only exists on the remote Host', async () => {
  // The Session's cwd is the remote machine's path. A client that stats it
  // locally would refuse to open the column at all, which is the bug this pins.
  const home = mkdtempSync(join(tmpdir(), 'hulala-remote-cwd-'))
  const fake = fakeBackend('/remote/only/path')
  const editor = fakeEditor({ clean: true, anyCwd: true })
  const tty = startPtyTty(home, fake, { editor, remote: 'devbox' })
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  tty.input.write(CTRL_D)
  await waitFor(() => editor.spawned(), 'editor column')
  // The editor holds the keyboard, so closing it is what returns `/quit` to the
  // composer; Neovim is clean, so it leaves at once.
  tty.input.write(CTRL_D)
  await new Promise(resolve => setTimeout(resolve, 150))
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a plain launch starts a new Session in the directory it was run from', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-fresh-session-'))
  // A record an older client left behind, and a Session that record names: a
  // launch must ignore both, because opening that Session would also adopt its
  // directory as this window's instead of the one the shell is in.
  mkdirSync(join(home, 'config'), { recursive: true })
  writeFileSync(join(home, 'config', 'client.json'), `${JSON.stringify({ lastSessionByHost: { local: 'session-older' } })}\n`)
  const fake = fakeBackend('/workspace')
  fake.setSessions([
    { sessionId: 'session-older', updatedAt: Date.now(), running: false, blank: false, cwd: '/somewhere/else' },
  ])
  const previousHome = process.env.HULALA_HOME
  process.env.HULALA_HOME = home
  const tty = startTty(fake, 100, undefined, null)
  cleanups.push(() => {
    if (previousHome === undefined) delete process.env.HULALA_HOME
    else process.env.HULALA_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })
  await waitFor(() => fake.followed.length > 0, 'a Session')
  expect(fake.followed).toEqual(['session-new'])
  expect(fake.created).toEqual(['session-new'])
  expect(fake.workspaces).toEqual(['/workspace'])
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('an explicit --resume of a Session that is gone says so and opens another', async () => {
  // The id can come from another process (`/update` hands it over) or from the
  // command line; a deleted Session must not leave a dead subscription behind.
  const fake = fakeBackend()
  const tty = startTty(fake, 100, undefined, 'session-deleted')
  await waitFor(() => plain(tty.painted()).includes('is gone'), 'the missing-Session notice')
  expect(fake.followed).not.toContain('session-deleted')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a remote window starts its Session in the Host default workspace', async () => {
  // `process.cwd()` is a path on this machine. Creating a Workspace from it on
  // another machine fails — and used to close the window.
  const home = mkdtempSync(join(tmpdir(), 'hulala-remote-workspace-'))
  const fake = fakeBackend('/remote/only/path')
  const editor = fakeEditor({ clean: true, anyCwd: true })
  const tty = startPtyTty(home, fake, { editor, remote: 'devbox' })
  await waitFor(() => plain(tty.painted()).includes('history answer') || fake.created.length > 0, 'a Session')
  expect(fake.workspaces).toEqual([])
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('a Host that cannot create the workspace says so and keeps the window', async () => {
  const fake = fakeBackend('/gone')
  fake.failWorkspace('cannot create a Workspace at "/gone": ENOENT: no such file or directory, realpath')
  const tty = startTty(fake, 100, undefined, null)
  try {
    await waitFor(() => plain(tty.painted()).includes('cannot create a Workspace'), 'the workspace error row')
    expect(plain(tty.painted())).toContain('realpath')
    // The frame is still there and still answers: the notice is not an exit.
    tty.input.write('/quit\r')
    await expect(tty.run).resolves.toBe(0)
  } finally {
    // Nothing else to clean: `startTty` owns the temporary state root.
  }
})

test('a reconnect drops half a sequence instead of typing it', async () => {
  // A window that was away — a machine that slept, an ssh forward that died —
  // can come back holding half of a report whose stream no longer exists. The
  // client has to throw it away rather than drain it (draining types `[<64;60;`
  // into whatever has the keyboard), and repaint from scratch, because a
  // differential frame keeps every cell it believes is unchanged.
  const transport: { state: 'connected' | 'disconnected' } = { state: 'connected' }
  const watchers = new Set<() => void>()
  const fake = fakeBackend('/workspace', {
    connection: {
      state: () => transport.state,
      subscribe: handler => {
        watchers.add(handler)
        return () => { watchers.delete(handler) }
      },
    },
  })
  const home = mkdtempSync(join(tmpdir(), 'hulala-recover-'))
  const previousHome = process.env.HULALA_HOME
  const previousDebug = process.env.HULALA_DEBUG_CLIENT
  process.env.HULALA_HOME = home
  process.env.HULALA_DEBUG_CLIENT = '1'
  // The client's trace is best-effort: it does not create the directory.
  mkdirSync(join(home, 'logs'), { recursive: true })
  cleanups.push(() => {
    if (previousHome === undefined) delete process.env.HULALA_HOME
    else process.env.HULALA_HOME = previousHome
    if (previousDebug === undefined) delete process.env.HULALA_DEBUG_CLIENT
    else process.env.HULALA_DEBUG_CLIENT = previousDebug
    rmSync(home, { recursive: true, force: true })
  })
  const trace = (): string => {
    const file = join(home, 'logs', 'tui-debug.log')
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  }

  const tty = startTty(fake)
  await waitFor(() => tty.painted().includes('❯'), 'the composer')
  await waitFor(() => fake.followed.length === 1, 'the first follow stream')
  // Half a report is in the parser's hands when the socket dies.
  tty.input.write('\u001b[<64;60;')
  await new Promise(resolve => setTimeout(resolve, 40))
  transport.state = 'disconnected'
  fake.handlers?.onError('socket closed')
  for (const watcher of watchers) watcher()
  await new Promise(resolve => setTimeout(resolve, 120))
  const beforeRecovery = tty.painted().length
  transport.state = 'connected'
  for (const watcher of watchers) watcher()
  await waitFor(() => fake.followed.length === 2, 'the reattached stream')
  await waitFor(() => trace().includes('reset reconnected'), 'the recovery trace')
  await waitFor(() => tty.painted().length > beforeRecovery, 'the recovery frame')
  // The fragment is named in the trace as dropped, and never became typing.
  expect(trace()).toContain('reset reconnected dropped "\\u001b[<64;60;"')
  expect(tty.painted()).not.toContain('[<64;60;')
  // The recovery also rebuilds the frame: a window that was away cannot trust
  // the cells it left behind, so the composer comes back in full afterwards.
  expect(tty.painted().slice(beforeRecovery)).toContain('❯')
})

test('a dropped follow stream reattaches without waiting on a Host call', async () => {
  // The reopen used to read the model catalog before subscribing the stream, so a
  // single stalled RPC left the window disconnected for as long as it was open —
  // the transport retried underneath, and the transcript never came back.
  const transport: { state: 'connected' | 'disconnected' } = { state: 'connected' }
  const watchers = new Set<() => void>()
  let catalogCalls = 0
  const fake = fakeBackend('/workspace', {
    catalog: () => {
      catalogCalls += 1
      return new Promise<TerminalModelCatalog>(() => undefined)
    },
    connection: {
      state: () => transport.state,
      subscribe: handler => {
        watchers.add(handler)
        return () => { watchers.delete(handler) }
      },
    },
  })
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 60 })
  cleanups.push(() => { input.destroy(); output.destroy() })
  void runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', escapeTimeoutMs: 20 })
  await waitFor(() => fake.followed.length === 1, 'the first follow stream')

  // The socket dies: the stream fails with it while the transport goes down.
  transport.state = 'disconnected'
  fake.handlers?.onError('socket closed')
  for (const watcher of watchers) watcher()
  await new Promise(resolve => setTimeout(resolve, 120))
  // Nothing may be retried while the transport is down: the mux would park the
  // request until a socket returns, and each parked request is a leaked stream.
  expect(fake.followed).toHaveLength(1)

  // The transport is back. The stream has to be re-attached now, and the stalled
  // catalog — already pending from the first open — must not stand in the way.
  transport.state = 'connected'
  for (const watcher of watchers) watcher()
  await waitFor(() => fake.followed.length === 2, 'the reattached stream')
  expect(catalogCalls).toBeGreaterThan(0)
})

test('the frame asks for button motion only, so a trackpad does not flood input', async () => {
  // All-motion tracking (`?1003`) makes every pointer movement a report. The
  // renderer asks for it on any terminal it does not recognise as a multiplexer;
  // the adapter strips the request and writes the disable itself, so the mode is
  // never on in the first place.
  const tty = startTty(fakeBackend())
  await waitFor(() => tty.painted().includes('❯'), 'composer')
  const painted = tty.painted()
  expect(painted).not.toContain('\u001b[?1003h')
  expect(painted).toContain('\u001b[?1002h')
  expect(painted).toContain('\u001b[?1006h')
  // The disable comes *before* the renderer's enable. Ghostty keeps mouse
  // reporting in one flag and any mode's reset turns the whole group off, so
  // `?1003l` after `?1002h` leaves no mouse at all; the alternate screen then
  // turns a trackpad scroll into Up/Down keys, which is history recall in the
  // composer rather than a moving transcript.
  expect(painted.indexOf('\u001b[?1003l')).toBeGreaterThanOrEqual(0)
  expect(painted.indexOf('\u001b[?1003l')).toBeLessThan(painted.indexOf('\u001b[?1002h'))
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('focus reports are turned off, so a screenshot does not type them', async () => {
  // `ESC [ I` and `ESC [ O` arrive whenever the window's focus changes — taking a
  // screenshot, clicking another window — and each is a sequence that can be
  // split and typed. The adapter never lets the enable through, and clears any
  // state a previous program left behind.
  const tty = startTty(fakeBackend())
  await waitFor(() => tty.painted().includes('❯'), 'composer')
  expect(tty.painted()).not.toContain('\u001b[?1004h')
  expect(tty.painted()).toContain('\u001b[?1004l')
  // And the key itself reaches nobody: the composer keeps only what was typed.
  tty.input.write('\u001b[I')
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(tty.painted()).not.toContain('[I')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Up recalls a prompt the resumed Session already carries', async () => {
  // pi seeds the editor history from the loaded Session, so a prompt sent before
  // this window existed is still reachable with Up. hulala used to remember only
  // what this process had submitted, which left Up with nothing after a restart.
  const tty = startTty(fakeBackend())
  await waitFor(() => tty.painted().includes('history answer'), 'replayed transcript')
  const mark = tty.painted().length
  tty.input.write('\u001b[A')
  await waitFor(() => plain(tty.painted().slice(mark)).includes('❯ history question'), 'recalled prompt')
  // Down gives the empty draft back, so the next Enter is not a stale prompt.
  const mark2 = tty.painted().length
  tty.input.write('\u001b[B')
  await waitFor(() => {
    const repainted = plain(tty.painted().slice(mark2))
    return repainted.includes('❯') && !repainted.includes('history question')
  }, 'the empty draft')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})
