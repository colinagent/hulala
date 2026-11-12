/**
 * Which clipboard a selection is copied to, and what the user is told when it
 * cannot be reached.
 *
 * The client runs either where the user sits or on the far side of an SSH link,
 * and only one of those clipboards can be pasted from. These tests pin the
 * routing: a remote session hands the text to the terminal, a local session
 * uses its own writer and never pretends an unverifiable terminal write worked.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  copyToClipboard,
  isRemoteSession,
  osc52,
  runClipboardWriter,
  type ClipboardPorts,
  type CopyResult,
} from '../../src/tui/clipboard.js'

interface Harness {
  readonly ports: ClipboardPorts
  /** Every OSC 52 sequence the copy wrote. */
  readonly written: string[]
  /** Every writer command the copy ran, in order. */
  readonly ran: Array<{ command: string; args: readonly string[]; input: string | undefined }>
  /** Writers that succeed; every other command fails as a missing binary would. */
  readonly succeed: Set<string>
}

function harness(overrides: Partial<ClipboardPorts> = {}): Harness {
  const written: string[] = []
  const ran: Harness['ran'] = []
  const succeed = new Set<string>(['pbcopy', 'clip', 'wl-copy', 'xclip', 'xsel', 'termux-clipboard-set'])
  const ports: ClipboardPorts = {
    env: {},
    platform: 'linux',
    write: data => written.push(data),
    run: async (command, args, input) => {
      ran.push({ command, args, input })
      return succeed.has(command) ? Buffer.alloc(0) : undefined
    },
    ...overrides,
  }
  return { ports, written, ran, succeed }
}

/** The text an OSC 52 sequence carries. */
function osc52Text(sequence: string): string {
  const match = /^\u001b\]52;c;([A-Za-z0-9+/=]*)\u0007$/u.exec(sequence)
  if (match === null) throw new Error(`not an OSC 52 sequence: ${JSON.stringify(sequence)}`)
  return Buffer.from(match[1] ?? '', 'base64').toString('utf8')
}

test('a remote session hands the selection to the terminal, not the remote box', async () => {
  const h = harness({ env: { SSH_CONNECTION: '10.0.0.2 51000 10.0.0.1 22' }, platform: 'darwin' })
  expect(await copyToClipboard('hello', h.ports)).toBe<CopyResult>('copied')
  expect(h.written.map(osc52Text)).toEqual(['hello'])
  // Nothing is started on the machine the user is not sitting at.
  expect(h.ran).toEqual([])
})

test('mosh and an explicit override both count as remote', async () => {
  expect(isRemoteSession({ MOSH_CONNECTION: '1 2 3 4' })).toBe(true)
  expect(isRemoteSession({ HULALA_CLIPBOARD: 'terminal' })).toBe(true)
  expect(isRemoteSession({ HULALA_CLIPBOARD: 'osc52' })).toBe(true)
  expect(isRemoteSession({ SSH_TTY: '/dev/ttys004' })).toBe(true)
  expect(isRemoteSession({ TERM: 'xterm-256color' })).toBe(false)
})

test('a remote copy reaches the terminal even with a local native helper', async () => {
  let nativeCalls = 0
  const h = harness({
    env: { SSH_CLIENT: '10.0.0.2 51000 22' },
    platform: 'darwin',
    native: {
      setText: async () => {
        nativeCalls += 1
      },
    },
  })
  await copyToClipboard('over ssh', h.ports)
  expect(nativeCalls).toBe(0)
  expect(h.written.map(osc52Text)).toEqual(['over ssh'])
})

test('a local macOS session copies natively and never writes OSC 52', async () => {
  const copied: string[] = []
  const h = harness({ platform: 'darwin', native: { setText: async text => { copied.push(text) } } })
  await copyToClipboard('local text', h.ports)
  expect(copied).toEqual(['local text'])
  expect(h.written).toEqual([])
  expect(h.ran).toEqual([])
})

test('a native helper that throws falls back to pbcopy', async () => {
  const h = harness({
    platform: 'darwin',
    native: { setText: async () => { throw new Error('no pasteboard') } },
  })
  expect(await copyToClipboard('local text', h.ports)).toBe<CopyResult>('copied')
  expect(h.ran.map(entry => entry.command)).toEqual(['pbcopy'])
  expect(h.ran[0]?.input).toBe('local text')
  expect(h.written).toEqual([])
})

test('a local Linux session prefers Wayland, then X11, and stops at the first winner', async () => {
  const h = harness({ env: { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' } })
  h.succeed.delete('wl-copy')
  await copyToClipboard('linux text', h.ports)
  expect(h.ran.map(entry => entry.command)).toEqual(['wl-copy', 'xclip'])
  expect(h.ran[1]?.args).toEqual(['-selection', 'clipboard'])

  const second = harness({ env: { DISPLAY: ':0' } })
  second.succeed.delete('xclip')
  await copyToClipboard('linux text', second.ports)
  expect(second.ran.map(entry => entry.command)).toEqual(['xclip', 'xsel'])
  expect(second.ran[1]?.args).toEqual(['--clipboard', '--input'])
})

test('Termux writes its own clipboard first', async () => {
  const h = harness({ env: { TERMUX_VERSION: '0.118', DISPLAY: ':0' } })
  await copyToClipboard('android text', h.ports)
  expect(h.ran.map(entry => entry.command)).toEqual(['termux-clipboard-set'])
})

test('a local Linux session with no writer says which one to install', async () => {
  const wayland = harness({ env: { WAYLAND_DISPLAY: 'wayland-0' } })
  wayland.succeed.clear()
  expect(await copyToClipboard('text', wayland.ports)).toBe<CopyResult>('wayland')
  expect(wayland.written).toEqual([])

  const x11 = harness({ env: { DISPLAY: ':0' } })
  x11.succeed.clear()
  expect(await copyToClipboard('text', x11.ports)).toBe<CopyResult>('x11')
  expect(x11.written).toEqual([])
})

test('a display-less Linux has no clipboard of its own, so the terminal is used', async () => {
  const h = harness({ env: {} })
  await copyToClipboard('container text', h.ports)
  expect(h.written.map(osc52Text)).toEqual(['container text'])
  expect(h.ran).toEqual([])
})

test('Windows uses clip', async () => {
  const h = harness({ platform: 'win32' })
  await copyToClipboard('windows text', h.ports)
  expect(h.ran.map(entry => entry.command)).toEqual(['clip'])
})

test('a platform with no writer reports that instead of copying', async () => {
  const h = harness({ platform: 'freebsd' })
  expect(await copyToClipboard('text', h.ports)).toBe<CopyResult>('unsupported')
  expect(h.written).toEqual([])
})

test('a selection too large for one terminal sequence is refused, not truncated', async () => {
  const h = harness({ env: { SSH_CONNECTION: 'a b c d' } })
  // 4 characters of base64 per 3 bytes, rounded up, against the limit.
  expect(osc52('x'.repeat(75_000))).toBeDefined()
  expect(osc52('x'.repeat(75_001))).toBeUndefined()
  expect(await copyToClipboard('x'.repeat(75_001), h.ports)).toBe<CopyResult>('too-large')
  expect(h.written).toEqual([])
})

test('an empty selection copies nothing and reports success', async () => {
  const h = harness({ env: { SSH_CONNECTION: 'a b c d' } })
  expect(await copyToClipboard('', h.ports)).toBe<CopyResult>('copied')
  expect(h.written).toEqual([])
})

test('the writer command receives UTF-8 on stdin', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hulala-clipboard-'))
  const target = join(directory, 'clip.txt')
  try {
    const script = `process.stdin.pipe(require('node:fs').createWriteStream(${JSON.stringify(target)}))`
    expect(await runClipboardWriter(process.execPath, ['-e', script], 'café 日本語')).toBeDefined()
    expect(readFileSync(target, 'utf8')).toBe('café 日本語')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a writer that cannot start, or exits non-zero, is a failure', async () => {
  expect(await runClipboardWriter('hulala-no-such-clipboard-tool', [])).toBeUndefined()
  expect(await runClipboardWriter(process.execPath, ['-e', 'process.exit(3)'], 'text')).toBeUndefined()
})
