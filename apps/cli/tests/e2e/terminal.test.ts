import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  disposeHome,
  E2E_AVAILABLE,
  makeHome,
  startReadyClient,
  type ClientPty,
} from './clientPty.ts'

/**
 * The terminal as a process sees it.
 *
 * These are the cases the in-process TTY suite cannot reach: the signal and exit
 * guard, a closed window, and a real client starting a real Host. Input framing
 * itself is covered exhaustively in `tests/client/terminalInput.test.ts` and
 * `tests/input`; here it is exercised through the same pty a user has, after the
 * client has had to survive a real event loop.
 *
 * The whole file skips when the Host has not been built: `apps/server/dist` is a
 * build artifact, and passing against a Host that never answered would be a lie.
 */

const e2e = E2E_AVAILABLE ? test : test.skip
const nvim = Bun.which('nvim')
const editorE2E = E2E_AVAILABLE && nvim !== null ? test : test.skip
if (!E2E_AVAILABLE) {
  console.warn('e2e: apps/server/dist is missing; run `bun run host:build` to enable the process-level suite')
} else if (nvim === null) {
  console.warn('e2e: no nvim on PATH; skipping the real-editor column case')
}

let home = ''
beforeAll(() => { home = makeHome('e2e') })
afterAll(async () => { if (home !== '') await disposeHome(home) })

/** Start a client, and always stop it, even when an assertion threw. */
async function withClient(run: (client: ClientPty) => Promise<void>): Promise<void> {
  const client = await startReadyClient({ home })
  try {
    await run(client)
  } finally {
    await client.dispose()
  }
}

e2e('the frame refuses bare motion, keeps focus reporting, and restores the terminal', async () => {
  await withClient(async (client) => {
    const modes = client.mouseModes()
    // Bare motion is refused; a disable is still written, for a terminal a
    // previous program left in that mode. Focus reporting is kept on — it is how
    // the client learns nobody is looking at this window — and the wrapper reads
    // the reports before the screen consumes them, so they are never typed.
    expect(modes).not.toContain('1003h')
    expect(modes).toContain('1003l')
    expect(modes).toContain('1004h')
    expect(modes).toContain('1002h')
    expect(modes).toContain('1006h')

    const code = await client.quit()
    expect(code).toBe(0)
    const tail = client.output().slice(-400)
    expect(tail).toContain('\u001b[?1049l')
    expect(tail).toContain('\u001b[?1006l')
    expect(tail).toContain('\u001b[?2026l')
    expect(tail).toContain('\u001b[0 q')
  })
}, 30_000)

e2e('an arrow key read whole moves the composer caret', async () => {
  await withClient(async (client) => {
    client.write('ab')
    await client.waitFor(screen => screen.includes('ab'), 'the typed letters')
    // One read, one arrow: the caret lands between `a` and `b`, and the next
    // key is inserted there. This is the behaviour the split cases must not
    // destroy.
    client.write('\u001b[D')
    await new Promise(resolve => setTimeout(resolve, 80))
    client.write('X')
    await client.waitFor(screen => screen.includes('aXb'), 'aXb after Left and X')
    expect(await client.quit()).toBe(0)
  })
}, 30_000)

e2e('a tail that follows a delivered Escape is consumed, never typed', async () => {
  await withClient(async (client) => {
    client.write('ab')
    await client.waitFor(screen => screen.includes('ab'), 'the typed letters')
    // Past the escape hold: the frame already saw the Escape key (which moves
    // focus out of the composer). The tail is still recognised as the arrow it
    // is — consumed by the frame — and never typed as `[D`.
    client.write('\u001b')
    await new Promise(resolve => setTimeout(resolve, 150))
    client.write('[D')
    await new Promise(resolve => setTimeout(resolve, 60))
    client.write('X')
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(client.screen()).not.toContain('ab[D')
    expect(client.screen()).not.toContain('b[D')
    expect(await client.quit()).toBe(0)
  })
}, 30_000)

e2e('a pointer report split after its escape does not reach the composer', async () => {
  await withClient(async (client) => {
    // Ctrl-T opens the shell column and gives it the keyboard. The report's
    // escape is delivered first; the tail that follows is a report, never text.
    client.write('\u0014')
    await new Promise(resolve => setTimeout(resolve, 800))
    client.write('\u001b[<35;6')
    await new Promise(resolve => setTimeout(resolve, 150))
    client.write('7;18M')
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(client.screen()).not.toContain('35;')
    expect(client.screen()).not.toContain('18M')
    expect(await client.quit()).toBe(0)
  })
}, 30_000)

e2e('a paste split across reads is pasted once, with no marker left as text', async () => {
  await withClient(async (client) => {
    client.write('\u001b[200~line one\n')
    await new Promise(resolve => setTimeout(resolve, 150))
    client.write('line two\u001b[201~')
    await client.waitFor(screen => screen.includes('line one') && screen.includes('line two'), 'the pasted text')
    expect(client.screen()).not.toContain('200~')
    expect(client.screen()).not.toContain('201~')
    expect(await client.quit()).toBe(0)
  })
}, 30_000)

e2e('the terminal column runs a real shell, paints CJK, and survives a resize', async () => {
  await withClient(async (client) => {
    client.write('\u0014')
    // The shell prompt is the proof the column actually opened: a transcript
    // false-positive used to pass this test without a shell behind it. The
    // marker is set here rather than guessed from the machine's prompt, which
    // made this pass only on the developer's laptop.
    client.write("PS1='hulala-e2e$ '\r")
    await client.waitFor(screen => screen.includes('hulala-e2e$'), 'the shell prompt', 15_000)
    client.write("printf '中文 ok\\n'\r")
    await client.waitFor(screen => screen.includes('中文 ok'), 'CJK output in the shell column', 10_000)

    client.resize(90, 30)
    await new Promise(resolve => setTimeout(resolve, 600))
    client.write('echo resize-ok\r')
    await client.waitFor(screen => screen.includes('resize-ok'), 'input after the resize', 10_000)
    expect(await client.quit()).toBe(0)
  })
}, 40_000)

editorE2E('the editor column runs a real Neovim and returns to the composer', async () => {
  // The Host starts the system nvim when the state root has no published
  // editor. Ctrl-G opens it; insert mode and a wide character go through the
  // real channel, grid and cursor path, and `:q!` gives the frame back.
  const client = await startReadyClient({ home, cols: 120, rows: 36 })
  try {
    client.write('\u0007')
    await client.waitFor(screen => screen.includes('[Scratch]') || screen.includes('NVIM'), 'the editor column', 25_000)
    client.write('i你好')
    await client.waitFor(screen => screen.includes('你好'), 'wide characters in the editor', 10_000)
    client.write('\u001b')
    await new Promise(resolve => setTimeout(resolve, 300))
    client.write(':q!\r')
    await client.waitFor(screen => screen.includes('❯'), 'the composer after the editor', 15_000)
    expect(await client.quit()).toBe(0)
  } finally {
    await client.dispose()
  }
}, 60_000)

e2e('Ctrl-T pressed right after boot still opens the column', async () => {
  // The Host terminal is scoped to the Session id, which arrives with the boot.
  // A Ctrl-T pressed before it landed used to fail silently with "no pty"; the
  // open now defers until the id is known and then completes the focus.
  await withClient(async (client) => {
    client.write('\u0014')
    // Same marker as the column test: the prompt is set by the test, so this
    // does not depend on who owns the runner.
    client.write("PS1='hulala-e2e$ '\r")
    await client.waitFor(screen => screen.includes('hulala-e2e$'), 'the shell prompt', 15_000)
    client.write("printf 'race ok\\n'\r")
    await client.waitFor(screen => screen.includes('race ok'), 'the command output', 10_000)
    expect(await client.quit()).toBe(0)
  })
}, 40_000)

e2e('a tail that arrives past the escape window is dropped, never typed', async () => {
  await withClient(async (client) => {
    client.write('ab')
    await client.waitFor(screen => screen.includes('ab'), 'the typed letters')
    // The escape is delivered alone (the hold expired), the frame consumes it,
    // and the tail arrives too late to rejoin. It must not become text: the
    // screenshotted `[C` / `[D` garbage in the input line is this exact path.
    client.write('\u001b')
    await new Promise(resolve => setTimeout(resolve, 150))
    client.write('[D')
    await new Promise(resolve => setTimeout(resolve, 1_200))
    client.write('X')
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(client.screen()).not.toContain('[D')
    // The composer still takes typing: the drop must not eat the next key.
    expect(client.screen()).toContain('ab')
    expect(await client.quit()).toBe(0)
  })
}, 30_000)

e2e('SIGTERM gives the terminal back', async () => {
  await withClient(async (client) => {
    client.signal('SIGTERM')
    const code = await client.waitForExit(10_000)
    expect(code).toBe(143)
    const tail = client.output().slice(-400)
    expect(tail).toContain('\u001b[?1049l')
    expect(tail).toContain('\u001b[?1006l')
    expect(tail).toContain('\u001b[?2026l')
    expect(tail).toContain('\u001b[0 q')
  })
}, 30_000)

e2e('closing the window ends the client instead of leaving it attached', async () => {
  await withClient(async (client) => {
    client.closeTerminal()
    const code = await client.waitForExit(10_000)
    // The exit code is the client's own; the contract is that it leaves and
    // gives the terminal back, not the number a shell chose.
    // A pty whose master is closed has no terminal left to receive a restore
    // sequence; the contract here is that the client leaves instead of holding
    // a Host connection and a forward forever. The signal cases above are what
    // prove the restore bytes themselves.
    expect(code).not.toBeNull()
  })
}, 30_000)
