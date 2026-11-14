import { expect, test } from 'bun:test'
import { hostPty } from '../../src/tui/editor/hostPty.ts'
import type {
  HostTerminal,
  HostTerminalAttachment,
  HostTerminalEnvironment,
  HostTerminalShell,
  HostTerminals,
} from '../../src/tui/data/remote.ts'
import type { TerminalFrame, TerminalInput } from '@deepseek-ai/dsh-api-terminal-controller/types'

/**
 * The terminal column's Host-backed pty.
 *
 * These tests stand in for a live Host: the fake mints identities, hands back an
 * attachment, and lets the test push frames. What is asserted is only the
 * contract the column depends on — bytes in the VT, input in order, one exit —
 * because that contract is what makes a remote Host indistinguishable from a
 * local shell in the frame.
 */

interface Recorded {
  readonly created: Array<{ id: string, cols: number, rows: number, shellPath?: string }>
  readonly closed: string[]
  readonly sent: TerminalInput[]
  frames: Array<(frame: TerminalFrame) => void>
}

function fakeTerminals(options: { failCreate?: string, environment?: Partial<HostTerminalEnvironment> } = {}): {
  terminals: HostTerminals
  recorded: Recorded
} {
  const recorded: Recorded = { created: [], closed: [], sent: [], frames: [] }
  const terminals: HostTerminals = {
    async environment(): Promise<HostTerminalEnvironment> {
      return { cwd: '/work', maxCols: 500, maxRows: 200, scrollback: 1_000, ...options.environment }
    },
    async shells(): Promise<readonly HostTerminalShell[]> {
      return [{ path: '/bin/zsh', name: 'zsh', args: ['-i'] }]
    },
    async list(): Promise<readonly HostTerminal[]> {
      return []
    },
    async create(_sessionId, request): Promise<HostTerminal> {
      if (options.failCreate !== undefined) throw new Error(options.failCreate)
      recorded.created.push({
        id: request.id,
        cols: request.cols,
        rows: request.rows,
        ...(request.shellPath === undefined ? {} : { shellPath: request.shellPath }),
      })
      return {
        id: request.id,
        title: 'shell',
        cols: request.cols,
        rows: request.rows,
        state: 'running',
        exitCode: null,
      }
    },
    attach(): HostTerminalAttachment {
      return {
        onFrame(handler) { recorded.frames.push(handler) },
        send(input) { recorded.sent.push(input) },
        dispose() { recorded.frames = [] },
      }
    },
    async close(_sessionId, id) { recorded.closed.push(id) },
  }
  return { terminals, recorded }
}

/** Push one frame to every live attachment. */
function emit(recorded: Recorded, frame: TerminalFrame): void {
  for (const handler of [...recorded.frames]) handler(frame)
}

/** Let the create/attach promise chain settle. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const spawnOptions = { name: 'xterm-256color', cols: 80, rows: 24, cwd: '/work', env: {} }

test('a snapshot clears the screen, and output follows it verbatim', async () => {
  const { terminals, recorded } = fakeTerminals()
  const received: string[] = []
  const process = hostPty({ terminal: terminals, sessionId: 'session-1' }).spawn('/bin/zsh', [], spawnOptions)
  process.onData(data => received.push(data))
  await settle()

  expect(recorded.created).toHaveLength(1)
  expect(recorded.created[0]?.cols).toBe(80)
  emit(recorded, {
    type: 'snapshot',
    sequence: 0,
    screen: 'prompt $ ',
    info: { id: recorded.created[0]!.id as never, title: 'shell', shell: { path: '/bin/zsh', name: 'zsh', args: [] }, cwd: '/work', cols: 80, rows: 24, state: 'running', exitCode: null },
    writable: true,
  })
  emit(recorded, { type: 'output', sequence: 1, data: 'echo hi\r\n' })

  // The clear is what makes a reattach replace the previous paint rather than
  // interleave two of them.
  expect(received[0]).toBe('\u001b[0m\u001b[H\u001b[2Jprompt $ ')
  expect(received[1]).toBe('echo hi\r\n')
})

test('input typed before the attachment opens is sent afterwards as one command', async () => {
  const { terminals, recorded } = fakeTerminals()
  const process = hostPty({ terminal: terminals, sessionId: 'session-1' }).spawn('/bin/zsh', [], spawnOptions)
  process.write('l')
  process.write('s')
  expect(recorded.sent).toHaveLength(0)
  await settle()

  // Consecutive bytes typed before the wire exists are one command, not one
  // command per keystroke: the Host sequences commands, not keystrokes.
  expect(recorded.sent).toEqual([{ type: 'write', sequence: 1, data: 'ls' }])
})

test('input stops at the unacknowledged budget and resumes on ack', async () => {
  const { terminals, recorded } = fakeTerminals()
  const process = hostPty({ terminal: terminals, sessionId: 'session-1' }).spawn('/bin/zsh', [], spawnOptions)
  await settle()

  // One paste larger than the adapter's budget: the first chunk fits, the rest
  // waits, and no command is ever refused by the Host.
  const chunk = 'x'.repeat(1024)
  for (let index = 0; index < 40; index += 1) process.write(chunk)
  const sentBytes = recorded.sent.reduce((total, input) => total + (input.type === 'write' ? input.data.length : 0), 0)
  expect(sentBytes).toBeLessThanOrEqual(32 * 1024)
  expect(recorded.sent.length).toBe(32)

  for (const input of recorded.sent) emit(recorded, { type: 'ack', sequence: input.sequence })
  expect(recorded.sent.length).toBeGreaterThan(32)
})

test('a resize is command-sequenced like input, and held until the attachment exists', async () => {
  const { terminals, recorded } = fakeTerminals()
  const process = hostPty({ terminal: terminals, sessionId: 'session-1' }).spawn('/bin/zsh', [], spawnOptions)
  process.resize(100, 40)
  await settle()
  expect(recorded.sent).toContainEqual({ type: 'resize', sequence: 1, cols: 100, rows: 40 })
})

test('a state frame that is no longer running reports one exit', async () => {
  const { terminals, recorded } = fakeTerminals()
  const exits: number[] = []
  const process = hostPty({ terminal: terminals, sessionId: 'session-1' }).spawn('/bin/zsh', [], spawnOptions)
  process.onExit(event => exits.push(event.exitCode))
  await settle()

  const frames = recorded.frames.length
  emit(recorded, {
    type: 'state',
    info: { id: recorded.created[0]!.id as never, title: 'shell', shell: { path: '/bin/zsh', name: 'zsh', args: [] }, cwd: '/work', cols: 80, rows: 24, state: 'exited', exitCode: 0 },
    writable: false,
  })
  emit(recorded, {
    type: 'state',
    info: { id: recorded.created[0]!.id as never, title: 'shell', shell: { path: '/bin/zsh', name: 'zsh', args: [] }, cwd: '/work', cols: 80, rows: 24, state: 'exited', exitCode: 0 },
    writable: false,
  })
  expect(exits).toEqual([0])
  expect(frames).toBeGreaterThan(0)
})

test('kill closes the identity instead of leaving an orphan shell', async () => {
  const { terminals, recorded } = fakeTerminals()
  const process = hostPty({ terminal: terminals, sessionId: 'session-1' }).spawn('/bin/zsh', [], spawnOptions)
  await settle()
  process.kill()
  await settle()
  expect(recorded.closed).toEqual([recorded.created[0]!.id])
  expect(recorded.frames).toHaveLength(0)
})

test('a create failure reaches the column as text and one exit', async () => {
  const { terminals, recorded } = fakeTerminals({ failCreate: 'no such directory' })
  const received: string[] = []
  const failures: string[] = []
  const exits: number[] = []
  const process = hostPty({
    terminal: terminals,
    sessionId: 'session-1',
    onFailure: message => failures.push(message),
  }).spawn('/bin/zsh', [], spawnOptions)
  process.onData(data => received.push(data))
  process.onExit(event => exits.push(event.exitCode))
  await settle()

  expect(failures).toEqual(['no such directory'])
  expect(received.join('')).toContain('no such directory')
  expect(exits).toEqual([-1])
  expect(recorded.created).toHaveLength(0)
})

test('one large paste is split into writes the Host accepts', async () => {
  const { terminals, recorded } = fakeTerminals()
  const process = hostPty({ terminal: terminals, sessionId: 'session-1' }).spawn('/bin/zsh', [], spawnOptions)
  await settle()

  // A paste is one `write` of any size, while the Host throws past maxInputBytes
  // (64 KiB) for a single command — and counts UTF-8 bytes, not characters.
  const paste = '中'.repeat(20_000)
  process.write(paste)
  const pieces: string[] = []
  // Drain the window the way the Host does, one acknowledgement per command.
  for (let round = 0; round < 100; round += 1) {
    const pending = recorded.sent.filter(input => input.type === 'write').slice(pieces.length)
    if (pending.length === 0) break
    for (const input of pending) {
      if (input.type !== 'write') continue
      pieces.push(input.data)
      expect(Buffer.byteLength(input.data, 'utf8')).toBeLessThanOrEqual(16 * 1024)
      emit(recorded, { type: 'ack', sequence: input.sequence })
    }
  }
  // Never more than the Host's 64 KiB per command, and nothing cut mid-character:
  // the pieces rebuild the paste exactly.
  expect(pieces.length).toBeGreaterThan(3)
  expect(pieces.join('')).toBe(paste)
})
