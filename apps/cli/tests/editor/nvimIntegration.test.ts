import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NVIM_BASE_LUA } from '@hulala/editor-home'
import { NvimUi } from '../../src/tui/editor/nvimUi.ts'

/**
 * The editor column against a real Neovim.
 *
 * The unit tests pin the protocol shapes; these pin the contract with the
 * program itself: a UI attach replays the screen, UTF-8 text and wide
 * characters land in the cells the cursor counts, insert mode is reported,
 * mouse reporting follows Neovim's own option, paste uses `nvim_paste`, and
 * `:q!` ends the channel; and, loaded with the settings Hulala ships, the file
 * tree's own prompt lives exactly as long as the tree. They need no Host and no
 * network, so they are cheap enough to run on every change to the editor,
 * msgpack or grid.
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

/** A `nvim --embed` process with this column's UI attached to it. */
interface Editor {
  readonly ui: NvimUi
  /** Modes Neovim reported, in order. */
  readonly modes: string[]
  /** The visible text of the grid, one line per row. */
  screen(): string[]
  /** What `nvim --embed` returned, once it is gone. */
  exitCode(): number | undefined
  /** End the session and wait for the process to be reaped. */
  stop(): Promise<void>
}

/**
 * Start Neovim and attach, the way the editor column does.
 * @param options - the working directory, extra arguments and environment, and
 *   the grid size.
 * @returns the session the test drives.
 */
function startEditor(options: {
  readonly cwd: string
  readonly args?: readonly string[]
  readonly env?: Record<string, string>
  readonly cols: number
  readonly rows: number
}): Editor {
  const proc = Bun.spawn(
    [nvim ?? 'nvim', '--embed', '--headless', '-u', 'NONE', '-i', 'NONE', '-n', ...(options.args ?? [])],
    {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
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
  const modes: string[] = []
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
    cols: options.cols,
    rows: options.rows,
    color: true,
    onScreen: () => undefined,
    onExit: (code) => { exitCode = code },
    onMode: (mode) => { modes.push(mode) },
  })
  return {
    ui,
    modes,
    screen: () => ui.renderScreen(options.cols, options.rows, 'none', '').map(plain),
    exitCode: () => exitCode,
    stop: async () => {
      try { proc.kill() } catch { /* already exited */ }
      await read.catch(() => undefined)
      await proc.exited.catch(() => undefined)
    },
  }
}

integration('a real nvim --embed session draws text, cursor, mode, mouse and paste, then quits', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hulala-nvim-'))
  const editor = startEditor({ cwd, cols: 40, rows: 8 })
  const { ui, modes } = editor
  const screen = (): string[] => editor.screen()

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
    await waitFor(() => editor.exitCode() !== undefined, 'Neovim to exit')
    expect(editor.exitCode()).toBe(0)
  } finally {
    await editor.stop()
    rmSync(cwd, { recursive: true, force: true })
  }
}, 20_000)

integration('the file tree prompt lives exactly as long as the tree', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hulala-nvim-tree-'))
  writeFileSync(join(cwd, 'alpha.txt'), 'alpha\n')
  // Hulala's own settings, so the test drives the keys a user presses rather
  // than a picker configured here.
  const settings = join(cwd, 'hulala.lua')
  writeFileSync(settings, NVIM_BASE_LUA)
  const snacks = join(import.meta.dir, '..', '..', 'vendor', 'snacks.nvim')
  const editor = startEditor({
    cwd,
    args: ['--cmd', `lua dofile([[${settings}]])`],
    // Neovim and its plugins write under these on their own terms; keep every
    // one of them in the temporary directory instead of the user's home.
    env: {
      HULALA_NVIM_SNACKS: snacks,
      XDG_STATE_HOME: join(cwd, 'state'),
      XDG_DATA_HOME: join(cwd, 'data'),
      XDG_CACHE_HOME: join(cwd, 'cache'),
    },
    cols: 100,
    rows: 30,
  })
  const has = (text: string): boolean => editor.screen().some(line => line.includes(text))

  try {
    await waitFor(() => has('[No Name]'), 'the initial screen')

    editor.ui.inputNotation(' e')
    await waitFor(() => has('alpha.txt'), 'the file tree')

    // `a` in the tree opens its own prompt: a floating window outside the
    // picker's layout, which is why closing the layout alone left it behind
    // with the keyboard still inside it.
    editor.ui.input('a')
    await waitFor(() => has('Add a new file or directory'), 'the tree prompt')

    // Esc leaves the prompt in normal mode and keeps it on screen, which is
    // where a user ended up before the toggle had anything to take away with
    // the tree.
    editor.ui.input('\u001b')
    await waitFor(() => editor.ui.currentMode() === 'n', 'normal mode in the prompt')
    expect(has('Add a new file or directory')).toBe(true)

    editor.ui.inputNotation(' e')
    await waitFor(() => !has('Add a new file or directory'), 'the prompt to close with the tree')
    expect(has('alpha.txt')).toBe(false)

    editor.ui.inputNotation(':q!<CR>')
    await waitFor(() => editor.exitCode() !== undefined, 'Neovim to exit')
    expect(editor.exitCode()).toBe(0)
  } finally {
    await editor.stop()
    rmSync(cwd, { recursive: true, force: true })
  }
}, 20_000)
