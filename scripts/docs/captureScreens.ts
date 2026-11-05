/**
 * Capture the README and website screenshots under `assets/screens/`.
 *
 * The frames come from the real client: `runTerminalClient` runs with a fake
 * Host and a scripted pty, so layout, wrapping and colour are the shipped code
 * and nothing here redraws the product. The fake Host supplies a plausible
 * transcript and Session list; the scripted pty paints the two sidebar columns,
 * which are ordinary pty programs, so a script stands in for the shell and for
 * Neovim without either process being started.
 *
 *   bun scripts/docs/captureScreens.ts          # conversation, terminal, editor
 *   bun scripts/docs/captureScreens.ts --tree   # the real file tree (real Neovim)
 *
 * Rasterizing needs a local Chrome, so this is developer tooling, not a release
 * step. Run it from the repository root.
 *
 * @module hulala/scripts/docs/captureScreens
 */
import { PassThrough } from 'node:stream'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTerminalClient } from '../../apps/cli/src/tui/app.ts'
import type { PtyModule, PtyProcess, PtySpawnOptions } from '../../apps/cli/src/tui/editor/pty.ts'
import type { TerminalBackend, TerminalSession, TerminalSessionEvent, TerminalSessionHandlers } from '../../apps/cli/src/tui/data/remote.ts'
import { rasterizeFrame } from './rasterizeFrame.ts'
import { terminalReply } from './terminalTheme.ts'

// The tree shot gets a wider frame: a third of it has to hold whole names.
const COLS = process.argv.includes('--tree') ? 190 : 132
const ROWS = process.argv.includes('--tree') ? 34 : 28
const CWD = '/Users/colin/note/projects/hulala'
const OUT = 'assets/screens'

const R = '\u001b[0m'
const D = '\u001b[2m'
const S = {
  green: '\u001b[38;2;120;170;120m',
  brand: '\u001b[38;2;150;132;116m',
  blue: '\u001b[38;2;130;150;200m',
  yellow: '\u001b[38;2;200;175;120m',
  grey: '\u001b[38;2;115;117;122m',
}

/** A Neovim screen: the vendored editor's colours on a plausible file. */
const EDITOR_LINES: string[] = [
  `${S.grey}  1 ${R}${D}/**${R}`,
  `${S.grey}  2 ${R}${D} * Every panel that reads keys asks for English.${R}`,
  `${S.grey}  3 ${R}${D} * The composer never does.${R}`,
  `${S.grey}  4 ${R}${D} */${R}`,
  `${S.grey}  5 ${R}${S.blue}import${R} { spawn } ${S.blue}from${R} ${S.green}'node:child_process'${R}`,
  `${S.grey}  6 ${R}`,
  `${S.grey}  7 ${R}${S.blue}export interface${R} InputSource {`,
  `${S.grey}  8 ${R}  readonly id: string`,
  `${S.grey}  9 ${R}  readonly label: string`,
  `${S.grey} 10 ${R}}`,
  `${S.grey} 11 ${R}`,
  `${S.grey} 12 ${R}${S.blue}const${R} ENGLISH = ${S.green}'com.apple.keylayout.ABC'${R}`,
  `${S.grey} 13 ${R}`,
  `${S.grey} 14 ${R}${S.blue}export function${R} ${S.yellow}switchTo${R}(target: InputSource) {`,
  `${S.grey} 15 ${R}  ${S.blue}if${R} (target.id === ENGLISH) ${S.blue}return${R}`,
  `${S.grey} 16 ${R}  ${D}// bin/ime ships with the release${R}`,
  `${S.grey} 17 ${R}  spawn(imePath(), [target.id])`,
  `${S.grey} 18 ${R}}`,
  `${S.grey} 19 ${R}`,
  `${S.grey} 20 ${R}${D}// Ctrl-[ is byte-identical to Esc${R}`,
  `${S.grey} 21 ${R}${S.blue}export const${R} owns = (f: boolean) => f`,
  `${S.grey} 22 ${R}`,
  `${S.grey} 23 ${R}${D}~${R}`,
]

/** The editor's statusline, pinned to the pane's last row. */
function statusline(cols: number): string {
  const left = ' NORMAL  inputSource.ts'
  const right = '10:4 utf-8 '
  const pad = Math.max(1, cols - left.length - right.length)
  return `\u001b[48;2;38;40;45m\u001b[38;2;210;208;202m${left}${' '.repeat(pad)}${right}${R}`
}

/** A pty whose program paints a scripted screen instead of running one. */
function scriptedPty(): PtyModule {
  return {
    spawn(file: string, _args: string[], options: PtySpawnOptions): PtyProcess {
      const isEditor = /nvim/.test(file)
      let deliver: ((data: string) => void) | undefined
      let cols = options.cols
      let rows = options.rows
      const paint = (): void => {
        if (isEditor) {
          const code = EDITOR_LINES.slice(0, Math.max(1, rows - 1))
          while (code.length < rows - 1) code.push('')
          deliver?.(`\u001b[H\u001b[2J${code.join('\r\n')}\u001b[${rows};1H${statusline(cols)}`)
          return
        }
        const shell = [
          `${D}~/note/projects/hulala${R}`,
          `${S.brand}❯${R} git status --short`,
          `${S.yellow} M${R} apps/cli/src/tui/plugins/panes.ts`,
          `${S.yellow} M${R} apps/cli/src/tui/plugins/rail.ts`,
          `${S.yellow}??${R} scripts/docs/captureScreens.ts`,
          '',
          `${S.brand}❯${R} bun run test apps/cli/tests/client`,
          `${D}bun test v1.4.2 (79e5c1e0)${R}`,
          '',
          `${D}apps/cli/tests/client/focus.test.ts:${R}`,
          `${S.green}✓${R} Ctrl-T opens the terminal and focuses it ${D}[1.32ms]${R}`,
          `${S.green}✓${R} Ctrl-F swaps the sidebar to the editor ${D}[0.88ms]${R}`,
          `${S.green}✓${R} hiding a column keeps its process ${D}[0.41ms]${R}`,
          '',
          `${D} 3 pass${R}`,
          `${D} 0 fail${R}`,
          `${D}Ran 3 tests across 1 file. [0.21s]${R}`,
          '',
          `${S.brand}❯${R} `,
        ]
        deliver?.(`\u001b[H\u001b[2J${shell.slice(0, rows).join('\r\n')}`)
      }
      const timer = setTimeout(paint, 60)
      return {
        pid: 1,
        onData(handler) { deliver = handler },
        onExit() {},
        write() {},
        resize(nextCols: number, nextRows: number) { cols = nextCols; rows = nextRows; paint() },
        kill() { clearTimeout(timer) },
      }
    },
  }
}

const sessions: TerminalSession[] = [
  { sessionId: 'session-a', updatedAt: Date.now() - 2 * 60_000, running: false, blank: false, cwd: CWD, title: 'Pane switching keys' },
  { sessionId: 'session-b', updatedAt: Date.now() - 47 * 60_000, running: true, blank: false, cwd: CWD, title: 'Plugin API versioning' },
  { sessionId: 'session-c', updatedAt: Date.now() - 3 * 3_600_000, running: false, blank: false, cwd: CWD, title: 'Editor column autosave' },
  { sessionId: 'session-d', updatedAt: Date.now() - 26 * 3_600_000, running: false, blank: false, cwd: CWD, title: 'Host daemon handshake' },
  { sessionId: 'session-e', updatedAt: Date.now() - 2 * 86_400_000, running: false, blank: false, cwd: CWD, title: 'Release checklist' },
  { sessionId: 'session-f', updatedAt: Date.now() - 4 * 86_400_000, running: false, blank: false, cwd: CWD, title: 'No tmux, no runner script' },
]

const at = (seconds: number): number => Date.now() - seconds * 1000
const user = (seq: number, seconds: number, text: string): TerminalSessionEvent => ({
  type: 'user/message', seq, time: at(seconds),
  data: { source: { kind: 'user' }, content: [{ type: 'text', text }] },
})
const call = (seq: number, seconds: number, callId: string, name: string, args: Record<string, unknown>): TerminalSessionEvent => ({
  type: 'tool/call', seq, time: at(seconds), data: { callId, name, arguments: JSON.stringify(args) },
})
const result = (seq: number, seconds: number, callId: string, text: string): TerminalSessionEvent => ({
  type: 'tool/result', seq, time: at(seconds),
  data: { message: { toolCallId: callId, content: [{ type: 'text', text }] } },
})
const answer = (seq: number, seconds: number, text: string): TerminalSessionEvent => ({
  type: 'assistant/message', seq, time: at(seconds),
  data: { message: { content: [{ type: 'text', text }] }, usage: { inputTokens: 18_400, cacheReadTokens: 61_200, outputTokens: 512 } },
})

/** The one transcript every screenshot shows, so the set stays consistent. */
const transcript: TerminalSessionEvent[] = [
  user(1, 90, 'Add Ctrl-F as a real editor column, and keep its buffers when I hide it.'),
  call(2, 88, 'c1', 'read', { file_path: `${CWD}/apps/cli/src/tui/plugins/panes.ts` }),
  result(3, 87, 'c1', 'export interface TuiPanes { ... }'),
  call(4, 86, 'c2', 'bash', { command: 'bun run test apps/cli/tests/client', description: 'Run the terminal client tests' }),
  result(5, 80, 'c2', '3 pass\n0 fail\n[exit code: 0]'),
  answer(6, 76, 'The sidebar is one `ctx.effect`, so a hidden column keeps its process.\n\n- `Ctrl-T` runs your shell in the Session directory\n- `Ctrl-F` runs Neovim on `.`\n- `Ctrl-[` moves the keyboard back without closing either'),
  user(7, 70, 'Good. Now confirm nothing stops the Host when I close the window.'),
  call(8, 68, 'c3', 'bash', { command: 'hulala host status', description: 'Ask the Host whether it is still running' }),
  result(9, 64, 'c3', '{"state":"running","pid":27963,"protocol":2}\n[exit code: 0]'),
  answer(10, 60, '`Ctrl-Q` detaches the window; the turn and the Session keep going in the Host.\n\n`hulala host stop` is the only thing that stops it.'),
]

/** A Host with a fixed Session list and one transcript, published once. */
function fakeBackend(): TerminalBackend {
  return {
    host: { url: 'http://127.0.0.1:49552', home: '/Users/colin/.hulala' },
    async ready() {},
    async listSessions() { return sessions },
    async searchSessions() { return { items: [], hasMore: false } },
    async ensureWorkspace() { return 'workspace-1' },
    async createSession() { return 'session-a' },
    follow(_sessionId, live: TerminalSessionHandlers) {
      queueMicrotask(() => {
        for (const event of transcript) live.onEvent(event)
        live.onContextPressure?.({ projectedTokens: 142_000, contextWindow: 1_000_000 })
        live.onRunning(false)
        live.onInbox?.({ steering: [], followUp: [{ id: 'p1', text: 'Then screenshot the editor column for the README.' }] })
      })
      return () => undefined
    },
    async prompt() {},
    async removeQueued() {},
    async cancel() {},
    async modelCatalog() {
      return {
        default: { provider: 'deepseek-official', model: 'deepseek-flash' },
        groups: [{
          id: 'deepseek-official', name: 'DeepSeek',
          models: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', reasoning: { efforts: [{ id: 'off', name: 'Off' }], defaultEffort: 'off' } }],
        }],
        failures: [],
      }
    },
    async selectModel() {},
    async loginProviders() { return [] },
    async login() {},
    async rename() {},
    onApproval() { return () => undefined },
    onQuestion() { return () => undefined },
    onSessionStatus() { return () => undefined },
    onSessionError() { return () => undefined },
    onSessionList() { return () => undefined },
    async close() {},
  }
}

const input = Object.assign(new PassThrough(), {
  isTTY: true,
  setRawMode: (_mode: boolean): void => undefined,
  setEncoding: (): void => undefined,
})
const output = Object.assign(new PassThrough(), { isTTY: true, columns: COLS, rows: ROWS })
const chunks: Buffer[] = []
let seen = 0
output.on('data', (chunk: Buffer | string) => {
  const text = String(chunk)
  chunks.push(Buffer.from(chunk))
  // The client asks the terminal for its colours once, at start-up. A real
  // window answers; without the answer the editor theme falls back.
  seen += text.length
  for (const match of text.matchAll(/\u001b\](?:10|11|4;\d+);\?\u0007/gu)) {
    const reply = terminalReply(match[0])
    if (reply !== undefined) input.write(reply)
  }
})

const all = (): Buffer => Buffer.concat(chunks)
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Frames to capture: the key that opens the column, and the file it lands in. */
const TREE = process.argv.includes('--tree')

const SHOTS: Array<{ name: string; keys?: string[] }> = TREE
  ? [{ name: '04-files', keys: ['\u0006', `${'\u001b[B'.repeat(16)}\r`] }]
  : [
      { name: '01-conversation' },
      { name: '02-terminal', keys: ['\u0014'] },
      { name: '03-editor', keys: ['\u0006'] },
    ]

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'hulala-screens-'))
  void runTerminalClient({
    backend: fakeBackend(), cwd: CWD, input, output, resume: 'session-a',
    // The tree shot is the real editor: the vendored snacks explorer is what the
    // screenshot is meant to show, so nothing here paints over it.
    ...(TREE ? {} : { pty: scriptedPty() }),
    updateCheck: async () => undefined,
  })
  await wait(1400)
  for (const shot of SHOTS) {
    if (shot.keys !== undefined) {
      for (const [index, key] of shot.keys.entries()) {
        input.write(key)
        // The editor needs real time to start Neovim, paint its explorer and
        // open the file the tree lands on.
        await wait(TREE ? (index === 0 ? 6000 : 1600) : 900)
      }
    }
    const ansiPath = join(dir, `${shot.name}.ansi`)
    writeFileSync(ansiPath, all())
    const pngPath = `${OUT}/${shot.name}.png`
    const size = rasterizeFrame({ ansiPath, pngPath, cols: COLS, rows: ROWS })
    console.log(`${pngPath}  ${size.width}x${size.height}`)
  }
  process.exit(0)
}

void main()
