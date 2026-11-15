import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NvimUi } from '../../src/tui/editor/nvimUi.ts'

/**
 * The editor column against a real Neovim.
 *
 * The unit tests pin the protocol shapes; this one pins the contract with the
 * program itself: a UI attach replays the screen, UTF-8 text and wide
 * characters land in the cells the cursor counts, insert mode is reported,
 * mouse reporting follows Neovim's own option, paste uses `nvim_paste`, and
 * `:q!` ends the channel. It needs no Host and no network, so it is cheap enough
 * to run on every change to the editor, msgpack or grid.
 */

/** Strip SGR and pi-tui's cursor marker; what is left is the visible text. */
function plain(line: string): string {
  return line
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/\u001b_pi:[a-z]+\u0007/gu, '')
}

function waitFor(check: () => boolean, label: string, timeoutMs = 8_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = (): void => {
      if (check()) { resolve(); return }
      if (Date.now() - started > timeoutMs) { reject(new Error(`timed out waiting for ${label}`)); return }
      setTimeout(tick, 10)
    }
    tick()
  })
}

const nvim = Bun.which('nvim')
const integration = nvim === null ? test.skip : test
if (nvim === null) {
  console.warn('nvim integration: no nvim on PATH; skipping the real-editor contract')
}

integration('a real nvim --embed session draws text, cursor, mode, mouse and paste, then quits', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hulala-nvim-'))
  const proc = Bun.spawn(
    [nvim ?? 'nvim', '--embed', '--headless', '-u', 'NONE', '-i', 'NONE', '-n'],
    { cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  )
  let deliver: ((chunk: Uint8Array) => void) | undefined
  const pending: Uint8Array[] = []
  const read = (async () => {
    for await (const chunk of proc.stdout) {
      const bytes = chunk as Uint8Array
      if (deliver === undefined) pending.push(bytes)
      else deliver(bytes)
    }
  })()
  let modes: string[] = []
  let exitCode: number | undefined
  const ui = new NvimUi({
    channel: {
      send: chunk => { proc.stdin.write(chunk) },
      close: () => { try { proc.stdin.end() } catch { /* already gone */ } proc.kill() },
      onData: (handler) => {
        deliver = handler
        for (const chunk of pending.splice(0)) handler(chunk)
      },
      onExit: (handler) => { void proc.exited.then(code => { handler({ code }) }) },
      onProblem: () => undefined,
    },
    cols: 40,
    rows: 8,
    color: true,
    onScreen: () => undefined,
    onExit: (code) => { exitCode = code },
    onMode: (mode) => { modes.push(mode) },
  })
  const screen = (): string[] => ui.renderScreen(40, 8, 'none', '').map(plain)

  try {
    await waitFor(() => screen().some(line => line.includes('[No Name]')), 'the initial screen')

    ui.input('i')
    await waitFor(() => modes.includes('i'), 'insert mode')
    ui.input('你好')
    await waitFor(() => screen().some(line => line.includes('你好')), 'the typed wide characters')

    // The cursor is a cell in the same model as the glyphs: two wide characters
    // put it after four cells, not after two UTF-16 code units.
    const focused = ui.renderScreen(40, 8, 'focused', '')
    const raw = focused.find(text => plain(text).includes('你好')) ?? ''
    const textAt = plain(raw).indexOf('你好')
    const markerAt = raw.indexOf('\u001b_pi:c\u0007')
    expect(textAt).toBeGreaterThanOrEqual(0)
    expect(markerAt).toBeGreaterThan(textAt)

    ui.input('\u001b')
    await waitFor(() => modes.includes('n'), 'normal mode')

    ui.inputNotation(':set mouse=a<CR>')
    await waitFor(() => ui.mouseTracking(), 'mouse reporting on')
    ui.inputNotation(':set mouse=<CR>')
    await waitFor(() => !ui.mouseTracking(), 'mouse reporting off')

    ui.input('i')
    ui.input('\u001b[200~pasted 中文\u001b[201~')
    await waitFor(() => screen().some(text => text.includes('pasted 中文')), 'the pasted text')
    ui.input('\u001b')

    ui.inputNotation(':q!<CR>')
    await waitFor(() => exitCode !== undefined, 'Neovim to exit')
    expect(exitCode).toBe(0)
  } finally {
    try { proc.kill() } catch { /* already exited */ }
    await read.catch(() => undefined)
    rmSync(cwd, { recursive: true, force: true })
  }
}, 20_000)
