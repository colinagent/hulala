import { expect, test } from 'bun:test'
import type { PtyModule, PtySpawnOptions } from '../../src/tui/editor/pty.js'
import { resolveShell, startShellSession } from '../../src/tui/pane/shellSession.js'

test('the terminal runs the user shell, or POSIX sh when SHELL is unset', () => {
  expect(resolveShell({ SHELL: '/opt/homebrew/bin/fish' })).toBe('/opt/homebrew/bin/fish')
  // An exported but empty SHELL is the same as no shell at all.
  expect(resolveShell({ SHELL: '   ' })).toBe('/bin/sh')
  expect(resolveShell({})).toBe('/bin/sh')
})

test('the terminal starts an interactive shell in the Session directory', () => {
  const spawns: Array<{ file: string; args: string[]; options: PtySpawnOptions }> = []
  const module: PtyModule = {
    spawn(file, args, options) {
      spawns.push({ file, args, options })
      return {
        pid: 1,
        onData() {},
        onExit() {},
        write() {},
        resize() {},
        kill() {},
      }
    },
  }
  const session = startShellSession({
    pty: module,
    cwd: '/workspace',
    cols: 60,
    rows: 20,
    shell: '/bin/zsh',
    env: { HULALA_TERMINAL: '1' },
    onScreen: () => undefined,
    onExit: () => undefined,
  })
  expect(spawns).toHaveLength(1)
  // No `-l` and no `-i`: the pty itself makes the shell interactive, and a login
  // shell would re-source profile files over Hulala's PATH.
  expect(spawns[0]?.args).toEqual([])
  expect(spawns[0]?.file).toBe('/bin/zsh')
  expect(spawns[0]?.options.cwd).toBe('/workspace')
  expect(spawns[0]?.options.name).toBe('xterm-256color')
  expect(spawns[0]?.options.env.TERM).toBe('xterm-256color')
  expect(spawns[0]?.options.env.HULALA_TERMINAL).toBe('1')
  session.dispose()
})

test('the terminal keeps history it can page and return from', async () => {
  let deliver: ((data: string) => void) | undefined
  const module: PtyModule = {
    spawn() {
      return {
        pid: 1,
        onData(handler) { deliver = handler },
        onExit() {},
        write() {},
        resize() {},
        kill() {},
      }
    },
  }
  const session = startShellSession({
    pty: module,
    cwd: '/tmp',
    cols: 40,
    rows: 5,
    shell: '/bin/sh',
    onScreen: () => undefined,
    onExit: () => undefined,
  })
  for (let index = 0; index < 50; index += 1) deliver?.(`line ${index}\r\n`)
  // `@xterm/headless` parses queued writes on the microtask/event loop.
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(session.scrollable()).toBe(true)
  expect(session.scrollPages(-1)).toBe(true)
  expect(session.scrolledBack()).toBeGreaterThan(0)
  expect(session.follow()).toBe(true)
  expect(session.scrolledBack()).toBe(0)

  // A full-screen program switches to the alternate screen; its keys stay its own.
  deliver?.('\u001b[?1049h')
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(session.alternateScreen()).toBe(true)
  session.dispose()
})
