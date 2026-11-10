import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
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

/** Command chords as a terminal that took the Kitty keyboard report delivers them. */
const CMD_E = '\u001b[101;9u' // Neovim-only mode
const SHIFT_CMD_S = '\u001b[115;10u' // Session rail
const SHIFT_CMD_C = '\u001b[99;10u' // conversation
const SHIFT_CMD_P = '\u001b[112;10u' // command palette
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
  /** Session ids the fake Host created. */
  created: string[]
  /** Session ids the client attached its follow stream to, in call order. */
  followed: string[]
  /** Presets the client asked the Host to apply to a Session, in request order. */
  permissions: string[]
  /** Presets the client asked the Host to store as the new-Session default. */
  permissionDefaults: string[]
  /** How many times the Session list was fetched (the picker fetches it again). */
  listSessionsCalls(): number
  handlers: TerminalSessionHandlers | undefined
  approve(request: TerminalApproval): Promise<TerminalApprovalOutcome>
  ask(questions: readonly TerminalQuestion[]): Promise<{ answers: TerminalQuestionAnswer[] } | undefined>
  /** Publish both pending lists the way the Host's `inbox` projection does. */
  inbox(inbox: TerminalInbox): void
  /** Publish the `permissions` projection the way the Host's control stream does. */
  permission(preset: string): void
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
  const efforts: Array<string | undefined> = []
  /** Directories `ensureWorkspace` was asked for, in call order. */
  const workspaces: string[] = []
  /** Session ids the fake Host handed out. */
  const created: string[] = []
  const followed: string[] = []
  const permissions: string[] = []
  const permissionDefaults: string[] = []
  const hostCommands: string[] = []
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
    async setPermission(_sessionId, preset) { permissions.push(preset) },
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
    efforts,
    workspaces,
    created,
    followed,
    permissions,
    permissionDefaults,
    hostCommands,
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
    permission: preset => {
      if (liveHandlers === undefined) throw new Error('follow handler is not subscribed')
      liveHandlers.onPermission?.(preset)
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

test('TTY mode puts the Session directory on the window title', async () => {
  const fake = fakeBackend()
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  // Started in `/launch`; the Session the Host lists works in `/workspace`.
  const run = runTerminalClient({ backend: fake.backend, cwd: '/launch', input, output, resume: 'session-1234' })
  await waitFor(() => text.includes('\u001b]0;Hulala - workspace\u0007'), 'window title')
  // The Host names the Session after its first turn; the name joins the title
  // behind the directory and cannot end the OSC sequence early.
  fake.handlers?.onEvent({ type: 'session/title', seq: 4, time: Date.now(), data: { title: 'Fix the composer\u0007' } })
  await waitFor(() => text.includes('\u001b]0;Hulala - workspace - Fix the composer \u0007'), 'named window title')
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
  const tty = startPtyTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write(CTRL_D) // Ctrl-D: show and focus the Neovim column
  await waitFor(() => editor.spawned(), 'editor column')
  // The rail is painted beside the editor. Shift-Cmd-S hides it without stealing the
  // keyboard: leaving the column is Ctrl-[, and this key only shows or hides.
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
  const tty = startPtyTty(home, fake, editor.module)
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234' })
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/hulala-missing-column-dir', input, output, resume: 'session-1234' })
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/hulala-missing-column-dir', input, output, resume: 'session-1234' })
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
  const tty = startPtyTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  // The composer paints its own caret, so the terminal's cursor stays hidden and
  // untouched while the keyboard is in the prompt.
  await waitFor(() => tty.painted().includes('\u001b[?25l'), 'the client owns the caret')
  expect(tty.painted()).not.toContain('\u001b[2 q')

  tty.input.write(CTRL_D) // Ctrl-D: the column takes the keyboard and the caret
  await waitFor(() => editor.spawned(), 'editor column')
  // A program that never asked for a shape gets the block a shell has always had,
  // drawn by the terminal at the cell the program marked.
  await waitFor(() => tty.painted().includes('\u001b[2 q'), 'block caret for the column')
  await waitFor(() => /\u001b\[\d+;\d+H\u001b\[\?25h/.test(tty.painted()), 'the terminal cursor is placed and shown')

  // InsertEnter: Neovim asks for a bar (DECSCUSR 6), the way it does in a
  // terminal of its own. The bar is the terminal's, so it composites over the
  // character instead of replacing it — the reason the caret is not a glyph.
  editor.emit('\u001b[6 q')
  await waitFor(() => tty.painted().includes('\u001b[6 q'), 'bar caret in insert mode')

  // Ctrl-[ leaves the column for the composer, and the caret goes with it.
  tty.input.write('\u001b')
  await waitFor(() => tty.painted().includes('\u001b[0 q'), 'the caret returns to the client')

  tty.input.write('\u001d') // Ctrl-]: back into the column
  tty.input.write(CTRL_D) // and close it; Neovim is clean, so it leaves at once
  await new Promise(resolve => setTimeout(resolve, 200))
  tty.input.write('\u0011') // quit
  await expect(tty.run).resolves.toBe(0)
})

test('TTY mode keeps the sidebar open across focus changes and hands nvim its keys', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-sidebar-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_D) // Ctrl-D opens the Neovim column with the keyboard in it
  await waitFor(() => editor.spawned(), 'editor column')
  // The composer lost focus: its cursor stays visible as a half-opacity block
  // (or the hollow glyph when the test environment has colour off).
  await waitFor(() => /\u001b\[48;[25];/.test(tty.painted()) || tty.painted().includes('□'), 'dim composer cursor')

  // Ctrl-W is Neovim's: the window prefix reaches it instead of closing the
  // column. Ctrl-D is the column key and is covered by the close below.
  tty.input.write('\u0017')
  await waitFor(() => editor.writes().includes('\u0017'), 'nvim gets Ctrl-W')

  tty.input.write('\u001b') // normal mode: Ctrl-[ leaves to the composer, column stays
  await new Promise(resolve => setTimeout(resolve, 60))
  tty.input.write('from-composer\r')
  await waitFor(() => fake.prompts.includes('from-composer'), 'the composer has the keyboard')

  tty.input.write('\u001d') // Ctrl-]: back into the editor without restarting it
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
  const tty = startPtyTty(home, fake, editor.module)
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
  const tty = startPtyTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write(CTRL_D) // Ctrl-D: show and focus the Neovim column
  await waitFor(() => editor.spawned(), 'editor column')

  // Side by side the chord belongs to the frame: it moves the boundary between the
  // two columns and never reaches the program.
  tty.input.write('\u001b[91;13u') // Cmd-Ctrl-[
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(editor.writes()).not.toContain('\u001b[1;5D')

  // Cmd-E leaves the editor as the only column, so no frame boundary is drawn and
  // the chord has nothing to move here. It goes to Neovim, whose file tree draws
  // the one boundary still on screen, as the legacy Ctrl-Left / Ctrl-Right pair.
  // (Option-Left cannot be the tree's key: macOS takes Control-Left for switching
  // spaces, and what a terminal sends for Option-Left varies — one arrives as a
  // bare Escape and closes the tree instead of moving it.)
  tty.input.write(CMD_E)
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
  const handed = editor.writes()
  expect(handed.match(/\u001b\[1;5D/g)?.length ?? 0).toBe(3)
  expect(handed.match(/\u001b\[1;5C/g)?.length ?? 0).toBe(3)

  tty.input.write('\u0011') // and the client quits, Neovim being clean
  await expect(tty.run).resolves.toBe(0)
})

test('an extended key report reaches the column as the legacy byte it stands for', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-kitty-'))
  const fake = fakeBackend(home)
  const panes = fakePanes()
  const tty = startPtyTty(home, fake, panes.module)
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
  // gets the bytes it was reading before the protocol was switched on.
  tty.input.write('\u001b[99;5u') // Ctrl-C
  await waitFor(() => shellWrites().includes('\u0003'), 'Ctrl-C as its control byte')
  tty.input.write('\u001b[27u') // Esc
  await waitFor(() => shellWrites().includes('\u001b'), 'Esc as its control byte')
  tty.input.write('\u001b[106;3u') // Alt-j
  await waitFor(() => shellWrites().includes('\u001bj'), 'Alt-j as escape plus j')
  expect(shellWrites()).not.toContain('[99;5u')

  tty.input.write('\u0011') // and the client quits, popping the keyboard mode
  await expect(tty.run).resolves.toBe(0)
  expect(tty.painted()).toContain('\u001b[<u')
})

test('TTY mode opens the built-in terminal on Ctrl-T and swaps to Neovim on Ctrl-D', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-terminal-'))
  const fake = fakeBackend(home)
  const panes = fakePanes()
  const tty = startPtyTty(home, fake, panes.module)
  const shellWrites = (): string => panes.panes[0]?.writes.join('') ?? ''
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_T) // Ctrl-T: the shell column opens with the keyboard in it
  await waitFor(() => panes.panes.length === 1, 'terminal column')
  tty.input.write('git status')
  await waitFor(() => shellWrites().includes('git status'), 'keys reach the shell')

  // An idle shell gives Ctrl-[ back: the column stays and the composer takes the
  // keyboard, with the shell still painted beside it.
  tty.input.write('\u001b')
  await new Promise(resolve => setTimeout(resolve, 60))
  panes.panes[0]?.emit('\r\nVISIBLE-MARKER')
  await waitFor(() => tty.painted().includes('VISIBLE-MARKER'), 'the sidebar stays painted without focus')
  tty.input.write('from-composer\r')
  await waitFor(() => fake.prompts.includes('from-composer'), 'the composer has the keyboard')

  // Ctrl-] returns to the same shell; no new process is started.
  tty.input.write('\u001d')
  tty.input.write('reentered')
  await waitFor(() => shellWrites().includes('reentered'), 'the shell kept its process')

  // Ctrl-D swaps the painted column to Neovim. The shell stays alive.
  tty.input.write(CTRL_D)
  await waitFor(() => panes.panes.length === 2, 'editor column')
  tty.input.write('nvim-key')
  await waitFor(() => (panes.panes[1]?.writes.join('') ?? '').includes('nvim-key'), 'keys reach nvim')

  // Ctrl-T swaps back to the same shell, not a fresh one.
  tty.input.write(CTRL_T)
  tty.input.write('back-in-shell')
  await waitFor(() => shellWrites().includes('back-in-shell'), 'the shell survived the swap')
  expect(panes.panes[0]?.kills).toBe(0)
  expect(panes.panes.length).toBe(2)

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

  // Ctrl-] reopens the hidden column while its process is still alive.
  tty.input.write('\u001d')
  tty.input.write('reopened-key')
  await waitFor(() => shellWrites().includes('reopened-key'), 'the hidden shell reopens')
  expect(panes.panes.length).toBe(2)

  tty.input.write('\u001b') // leave the shell so the cleanup can reach /quit
  await new Promise(resolve => setTimeout(resolve, 60))
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Ctrl-T hides a terminal column that is painted but not focused', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-terminal-unfocused-'))
  const fake = fakeBackend(home)
  const panes = fakePanes()
  const tty = startPtyTty(home, fake, panes.module)
  const shellWrites = (): string => panes.panes[0]?.writes.join('') ?? ''
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_T) // Ctrl-T: the shell column opens with the keyboard in it
  await waitFor(() => panes.panes.length === 1, 'terminal column')
  tty.input.write('\u001b') // Ctrl-[: back to the composer, the column stays
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

  // Ctrl-] is the key that puts the keyboard back into the running column.
  tty.input.write('\u001d')
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
  const tty = startPtyTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')

  tty.input.write(CTRL_D) // Ctrl-D: open and focus Neovim
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write('\u001b') // Ctrl-[: back to the composer, the column stays
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

test('Ctrl-[ belongs to a full-screen program in the terminal', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-terminal-esc-'))
  const fake = fakeBackend(home)
  const panes = fakePanes()
  const tty = startPtyTty(home, fake, panes.module)
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
function startTty(fake: FakeBackend, columns = 100, promptLanguage?: boolean): {
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
  const run = runTerminalClient({ backend: fake.backend, cwd: '/workspace', input, output, resume: 'session-1234', ...(promptLanguage === undefined ? {} : { promptLanguage }) })
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
function fakeEditor(options: { clean: boolean }): {
  module: PtyModule
  writes(): string
  spawned(): boolean
  saves(): number
  /** Columns of the last resize the pane asked the pty for. */
  width(): number | undefined
  /** Paint bytes as the program would, e.g. the DECSCUSR of an insert mode. */
  emit(chunk: string): void
} {
  const writes: string[] = []
  let clean = options.clean
  let spawned = false
  let saves = 0
  let cols: number | undefined
  let exit: ((event: { exitCode: number }) => void) | undefined
  let deliver: ((chunk: string) => void) | undefined
  const module: PtyModule = {
    spawn() {
      spawned = true
      let data: ((chunk: string) => void) | undefined
      return {
        pid: 1,
        onData(handler) { data = handler; deliver = handler },
        onExit(handler) { exit = handler },
        write(chunk) {
          writes.push(chunk)
          if (chunk.includes('wall') || chunk.includes('write!')) { clean = true; saves += 1 }
          const leave = chunk.includes(':qa!') || (chunk.includes(':qa') && clean)
          if (leave) queueMicrotask(() => exit?.({ exitCode: 0 }))
        },
        resize(width) { cols = width },
        kill() {},
      }
    },
  }
  return {
    module,
    writes: () => writes.join(''),
    spawned: () => spawned,
    saves: () => saves,
    width: () => cols,
    /** Paint bytes as the editor program: what it writes is what the column shows. */
    emit: (chunk: string) => deliver?.(chunk),
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
async function openEditorAndBlur(tty: ReturnType<typeof startPtyTty>, editor: ReturnType<typeof fakeEditor>): Promise<void> {
  tty.input.write(CTRL_D) // Ctrl-D: show and focus the Neovim column
  await waitFor(() => editor.spawned(), 'editor column')
  tty.input.write('\u001b') // Ctrl-[ : back to the composer, column stays
  await new Promise(resolve => setTimeout(resolve, 60))
}

test('quitting a clean editor asks nothing and leaves through :qa', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-gate-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, editor.module)
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
  const tty = startPtyTty(home, fake, editor.module)
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
  const tty = startPtyTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  await openEditorAndBlur(tty, editor)

  tty.input.write('\u0011')
  await waitFor(() => tty.painted().includes('There are unsaved files'), 'confirm dialog')
  tty.input.write('s') // save all, then Neovim leaves on its own
  await expect(tty.run).resolves.toBe(0)
  expect(editor.saves()).toBe(1)
  expect(editor.writes()).toContain('wall')
})

test('a file changed on disk by the agent becomes a question, not a clobber', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-conflict-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: false })
  const tty = startPtyTty(home, fake, editor.module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  await openEditorAndBlur(tty, editor)

  // What `init.lua` appends when autosave finds the buffer dirty and the file
  // already rewritten on disk.
  const marker = join(home, 'cache', 'editor', `conflict-${process.pid}.txt`)
  mkdirSync(dirname(marker), { recursive: true })
  writeFileSync(marker, `${join(home, 'notes.md')}\t${Date.now()}\n`)

  await waitFor(() => tty.painted().includes('changed on disk'), 'conflict dialog')
  tty.input.write('k') // keep mine: force the write
  await waitFor(() => editor.writes().includes(':write!'), 'forced write')
  expect(readFileSync(marker, 'utf8')).toBe('')

  tty.input.write('\u0011')
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
  const tty = startPtyTty(home, fake, editor.module)
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
  const tty = startPtyTty(home, fake, editor.module)
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
  const tty = startPtyTty(home, fake, module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write(CTRL_D)
  await waitFor(() => spawned, 'editor column')
  tty.input.write(CTRL_D) // close: no exit yet, so the dialog appears
  await waitFor(() => tty.painted().includes('There are unsaved files'), 'confirm dialog')
  await new Promise(resolve => setTimeout(resolve, 900)) // the process leaves with the dialog up

  tty.input.write('after-slow-close\r')
  await waitFor(() => fake.prompts.includes('after-slow-close'), 'the composer takes input again')
  tty.input.write('\u0011')
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
  const tty = startPtyTty(home, fake, module)
  await waitFor(() => tty.painted().includes('history answer'), 'transcript')
  tty.input.write(CTRL_D)
  await waitFor(() => spawned, 'editor column')
  tty.input.write(CTRL_D) // close: committed, just slow
  await new Promise(resolve => setTimeout(resolve, 2600))

  expect(tty.painted()).not.toContain('There are unsaved files')
  tty.input.write('after-slow-quit\r')
  await waitFor(() => fake.prompts.includes('after-slow-quit'), 'the composer keeps working')
  tty.input.write('\u0011')
  await expect(tty.run).resolves.toBe(0)
})

/** A temporary state root with no language, restored even when a test fails. */
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
    expect(readFileSync(languageFile(state.home), 'utf8').trim()).toBe('{"language":"zh-CN"}')
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
    expect(existsSync(languageFile(state.home))).toBe(false)
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
    expect(existsSync(languageFile(state.home))).toBe(false)
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
    expect(existsSync(languageFile(state.home))).toBe(false)
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
    await waitFor(() => readFileSync(languageFile(state.home), 'utf8').trim() === '{"language":"en"}', 'repaired file')
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
    expect(readFileSync(languageFile(state.home), 'utf8').trim()).toBe('{"language":"en"}')

    tty.input.write('/language xx\r')
    await waitFor(() => plain(tty.painted()).includes('unsupported language "xx"'), 'unsupported notice')
    expect(readFileSync(languageFile(state.home), 'utf8').trim()).toBe('{"language":"en"}')
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
    expect(readFileSync(languageFile(state.home), 'utf8').trim()).toBe('{"language":"en"}')
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
    const run = runTerminalClient({ backend: fakeBackend().backend, cwd: '/workspace', input, output, resume: 'session-1234' })
    await waitFor(() => text.includes('会话 session-1234'), 'Chinese plain session line')
    expect(text).not.toContain('Choose a language')
    expect(JSON.parse(readFileSync(languageFile(state.home), 'utf8'))).toEqual({ language: 'zh-CN' })
    input.write('/nope\n')
    await waitFor(() => text.includes('未知命令 /nope'), 'Chinese plain error')
    input.write('/quit\n')
    await expect(run).resolves.toBe(0)
  } finally {
    state.restore()
  }
})

test('Cmd-E leaves only Neovim, and the second press restores the frame', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-editor-only-'))
  const fake = fakeBackend(home)
  const editor = fakeEditor({ clean: true })
  const tty = startPtyTty(home, fake, editor.module)
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  tty.input.write(CMD_E)
  await waitFor(() => editor.spawned(), 'editor column')
  // The rail and the transcript are both gone: Neovim is the only column left.
  const focused = tty.painted().length
  await new Promise(resolve => setTimeout(resolve, 120))
  const after = plain(tty.painted().slice(focused))
  expect(after).not.toContain('+ new session')
  expect(plain(tty.painted().slice(focused))).not.toContain('history answer')
  // A second press restores the layout from before, its rail included.
  tty.input.write(CMD_E)
  await waitFor(() => plain(tty.painted().slice(focused)).includes('+ new session'), 'rail restored')
  await waitFor(() => plain(tty.painted().slice(focused)).includes('history answer'), 'conversation restored')
  tty.input.write('/quit\r')
  await expect(tty.run).resolves.toBe(0)
})

test('Cmd-E reports a column that cannot start instead of blanking the frame', async () => {
  // A directory that does not exist, so Neovim never registers a column. The
  // mode must leave the frame exactly as it was: the rail is still painted and
  // the failure names the column.
  const fake = fakeBackend('/hulala-missing-column-dir')
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean): void => undefined, setEncoding: (): void => undefined })
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 })
  let text = ''
  output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
  cleanups.push(() => { input.destroy(); output.destroy() })
  const run = runTerminalClient({ backend: fake.backend, cwd: '/hulala-missing-column-dir', input, output, resume: 'session-1234' })
  await waitFor(() => plain(text).includes('history answer'), 'transcript')
  input.write(CMD_E)
  await waitFor(() => plain(text).includes('editor unavailable'), 'editor column')
  expect(plain(text)).toContain('+ new session')
  expect(plain(text)).toContain('history answer')
  input.write('/quit\r')
  await expect(run).resolves.toBe(0)
})

test('Shift-Cmd-P lists commands with their shortcuts and runs one on Enter', async () => {
  const tty = startTty(fakeBackend())
  await waitFor(() => plain(tty.painted()).includes('history answer'), 'transcript')
  const mark = tty.painted().length
  tty.input.write(SHIFT_CMD_P)
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
  tty.input.write(SHIFT_CMD_P)
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
  tty.input.write(SHIFT_CMD_P)
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
  const tty = startPtyTty(home, fake, editor.module)
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
  const tty = startPtyTty(home, fake, editor.module)
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
  const tty = startPtyTty(home, fake, panes.module)
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
