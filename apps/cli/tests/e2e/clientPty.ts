/**
 * A real client process on a real pty, for the end-to-end cases.
 *
 * The in-process TTY tests are the right tool for most input behaviour. They
 * cannot see the three things only a process can show: the signal/exit guard,
 * the hangup a closed window produces, and the way a real client starts a real
 * Host from the built server. This harness starts the client the way a user
 * does, on a pty, with a temporary state root and no access to the developer's
 * own home.
 *
 * The pty is also a small terminal: {@link ClientPty.screen} strips escape
 * sequences so a test can ask "did the composer end up with `aXb`" without
 * emulating the whole screen. It deliberately does not simulate cell placement;
 * width and cursor placement are guarded by the screen-model tests, which can
 * read cells directly.
 *
 * @module hulala-cli/tests/e2e/clientPty
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, four levels up from `apps/cli/tests/e2e`. */
export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

/** Built Host entry the client starts when nothing answers. */
export const HOST_ENTRY = join(REPOSITORY_ROOT, 'apps', 'server', 'dist', 'hulala-desktop-server.mjs')

/**
 * Whether the process-level suite can run at all.
 *
 * `apps/server/dist` is a build artifact, not repository content. A clean clone
 * without `bun run host:build` must skip the whole file loudly rather than pass
 * silently against a Host that never answered.
 */
export const E2E_AVAILABLE = existsSync(HOST_ENTRY)

export interface ClientPty {
  /** Every byte the client wrote, decoded as UTF-8. */
  output(): string
  /** The output with escape sequences and control bytes removed. */
  screen(): string
  /** Write bytes as if the user's terminal read them. */
  write(data: string): void
  /** Change the pty size, the way a window resize does. */
  resize(cols: number, rows: number): void
  /** Wait until {@link screen} satisfies the predicate, or fail with the tail. */
  waitFor(predicate: (screen: string) => boolean, label: string, timeoutMs?: number): Promise<void>
  /** The modes the client switched, in order, as `1002h` / `1003l` / … */
  mouseModes(): string[]
  /** Send Ctrl-Q and wait for the process; returns its exit code. */
  quit(timeoutMs?: number): Promise<number | null>
  /** Wait for the process to end; null means it is still running. */
  waitForExit(timeoutMs?: number): Promise<number | null>
  /** The process exit code, or null while it is running. */
  exitCode(): number | null
  /** Deliver a signal the way a launcher or a closed terminal would. */
  signal(name: NodeJS.Signals): void
  /** Close the pty master: the window went away. */
  closeTerminal(): void
  /** Stop the process and release the pty. Safe after it already exited. */
  dispose(): Promise<void>
}

export interface StartClientOptions {
  /** State root shared by every client in the suite. */
  readonly home: string
  readonly cols?: number
  readonly rows?: number
  /** Arguments after the entry; `--remote` is not used by this suite. */
  readonly args?: readonly string[]
  /**
   * Bundle to run instead of the source entry.
   *
   * The release runs `apps/cli/dist/hulala.mjs`; a bundling-only bug (a library
   * that must be resolved at runtime rather than inlined) is invisible to the
   * source suite. A case that passes here after `build:client` is the packaging
   * guard.
   */
  readonly entry?: string
  /**
   * Runtime that runs the entry.
   *
   * The release artifact runs on the packaged Node; the source suite runs under
   * Bun. A built-artifact case passes this so it exercises the runtime the
   * archive actually starts.
   */
  readonly runtime?: string
}

/**
 * Create a temporary state root for one suite.
 * @param label - a short name for the directory.
 * @returns its absolute path.
 */
export function makeHome(label = 'e2e'): string {
  const home = join(tmpdir(), `hulala-${label}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`)
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })
  return home
}

/** Remove the state root, stopping the Host first. */
export async function disposeHome(home: string): Promise<void> {
  await stopHost(home)
  rmSync(home, { recursive: true, force: true })
}

/**
 * Stop the Host a suite started, without touching any other Host.
 *
 * The client deliberately detaches instead of killing the daemon, so the harness
 * has to read the endpoint and stop it. A test run that leaves daemons behind is
 * not a test run: the next one attaches to an old build and the failure is
 * indistinguishable from a product bug.
 * @param home - the suite's state root.
 */
export async function stopHost(home: string): Promise<void> {
  const endpoint = join(home, 'server', 'host', 'endpoint.json')
  if (!existsSync(endpoint)) return
  let pid: number
  try {
    pid = (JSON.parse(readFileSync(endpoint, 'utf8')) as { pid: number }).pid
  } catch {
    return
  }
  try { process.kill(pid, 'SIGTERM') } catch { return }
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
}

/** Strip OSC, APC/DCS, CSI and single-character escapes from a stream. */
export function plain(text: string): string {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu, '')
    .replace(/\u001b[_PX^][\s\S]*?\u001b\\/gu, '')
    .replace(/\u001b_pi:[a-z]+\u0007/gu, '')
    .replace(/\u001b\[[0-9;?<=>!]*[ -/]*[@-~]/gu, '')
    .replace(/\u001b[@-_]/gu, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, '')
}

/**
 * Start the client from source on a pty.
 *
 * `HOME` is redirected as well as `HULALA_HOME`: the Host's default Workspace
 * and the client's editor home are derived from the home directory, and a test
 * must not create either in the developer's own home.
 * @param options - the shared state root and the pty size.
 * @returns the running client.
 */
export async function startClient(options: StartClientOptions): Promise<ClientPty> {
  const decoder = new TextDecoder()
  let text = ''
  const entry = options.entry ?? join(REPOSITORY_ROOT, 'apps', 'cli', 'src', 'main.ts')
  const proc = Bun.spawn(
    [options.runtime ?? process.execPath, entry, ...(options.args ?? [])],
    {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        HOME: options.home,
        HULALA_HOME: options.home,
        TERM: 'xterm-ghostty',
        HULALA_LANG: 'en',
        // The client would otherwise select a system input source on every focus
        // edge: a pty run of a real client is still a test, and the developer's
        // keyboard belongs to the developer. (The temp state root already
        // forbids it; this states the intent where the client is started.)
        HULALA_INPUT_SOURCE: '0',
      },
      terminal: {
        cols: options.cols ?? 100,
        rows: options.rows ?? 30,
        name: 'xterm-ghostty',
        data: (_terminal, chunk) => { text += decoder.decode(chunk, { stream: true }) },
      },
    },
  )
  const terminal = proc.terminal
  if (terminal === undefined) throw new Error('Bun did not create a pty for the client')

  const exit = proc.exited.then((code) => { return code })
  let exitValue: number | null = null
  void exit.then((code) => { exitValue = code })

  const client: ClientPty = {
    output: () => text,
    screen: () => plain(text),
    write: (data) => { terminal.write(data) },
    resize: (cols, rows) => { terminal.resize(cols, rows) },
    async waitFor(predicate, label, timeoutMs = 20_000) {
      const started = Date.now()
      for (;;) {
        if (predicate(plain(text))) return
        if (exitValue !== null) {
          throw new Error(`client exited while waiting for ${label} (${String(exitValue)})\n${plain(text).slice(-800)}`)
        }
        if (Date.now() - started > timeoutMs) {
          throw new Error(`timed out waiting for ${label}\n${plain(text).slice(-800)}`)
        }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    },
    mouseModes: () => [...text.matchAll(/\u001b\[\?(\d+)([hl])/gu)].map(match => `${match[1]}${match[2]}`),
    async waitForExit(timeoutMs = 10_000) {
      return await Promise.race([exit, new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs))])
    },
    async quit(timeoutMs = 10_000) {
      terminal.write('\u0011')
      const code = await client.waitForExit(timeoutMs)
      if (code === null) {
        proc.kill('SIGKILL')
        throw new Error(`the client did not exit after Ctrl-Q\n${plain(text).slice(-800)}`)
      }
      return code
    },
    exitCode: () => exitValue,
    signal: (name) => { proc.kill(name) },
    closeTerminal: () => { terminal.close() },
    async dispose() {
      if (exitValue === null) {
        try { proc.kill('SIGKILL') } catch { /* already gone */ }
        await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 1_000))])
      }
      if (!terminal.closed) terminal.close()
    },
  }
  return client
}

/**
 * Start a client and wait until its composer is painted.
 *
 * The first client in a suite starts the Host, which is the slow step; later
 * ones attach to it. The composer glyph is the earliest stable signal that the
 * whole frame is up, and it is also where most input assertions happen.
 * @param options - the shared state root and the pty size.
 * @returns the ready client.
 */
export async function startReadyClient(options: StartClientOptions): Promise<ClientPty> {
  const client = await startClient(options)
  try {
    await client.waitFor(screen => screen.includes('❯'), 'the composer', 30_000)
  } catch (error) {
    await client.dispose()
    throw error
  }
  return client
}
