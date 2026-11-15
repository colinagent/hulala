/**
 * Starting another process from the client.
 *
 * The installed client runs on **Node**, and only the development checkout runs
 * on Bun. Anything that reached for `Bun.spawn` therefore worked in `bun run dev`
 * and threw `Bun is not defined` in the artifact users actually install — which
 * is how `hulala update --background` shipped broken. `node:child_process` is the
 * one API both runtimes implement, so it is the only one used here.
 *
 * @module hulala-cli/spawn
 */
import { spawn } from 'node:child_process'

/** One finished child process, with everything it wrote. */
export interface CollectedProcess {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run a command to completion and collect its output.
 *
 * Output is collected rather than inherited because the callers want the last
 * line to show the user, and a child writing directly to the terminal would
 * fight the alternate screen.
 * @param command - executable to run.
 * @param args - its arguments.
 * @returns exit code and both streams as text.
 */
export async function collect(command: string, args: readonly string[]): Promise<CollectedProcess> {
  return await new Promise<CollectedProcess>((resolve, reject) => {
    const child = spawn(command, [...args], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.once('error', reject)
    child.once('close', code => resolve({
      code: code ?? 1,
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8'),
    }))
  })
}

/**
 * Start a command that must outlive this process.
 *
 * `detached` puts the child in its own process group so it survives the parent's
 * exit — which is the point for a background download. It is **not** for a
 * process that takes this one's terminal: see {@link spawnHandoff}.
 * `unref` then lets this process exit instead of waiting on it.
 * @param command - executable to run.
 * @param args - its arguments.
 * @param stdio - `inherit` when the child takes the terminal, `ignore` otherwise.
 * @returns the child's pid, when the platform reports one.
 */
export function spawnDetached(
  command: string,
  args: readonly string[],
  stdio: 'inherit' | 'ignore',
): { readonly pid: number | undefined } {
  const child = spawn(command, [...args], {
    detached: true,
    stdio: stdio === 'inherit' ? ['inherit', 'inherit', 'inherit'] : ['ignore', 'ignore', 'ignore'],
    env: { ...process.env },
  })
  child.unref()
  return { pid: child.pid }
}

/**
 * Start the process that takes this one's terminal, and stay alive until it
 * leaves.
 *
 * A detached successor becomes the leader of a new session: it keeps the tty's
 * file descriptors but is no longer in the terminal's foreground process group.
 * The shell (or the dev wrapper) regains the foreground as soon as this process
 * exits, so two readers share one tty. Every escape sequence is then split —
 * `ESC` reaches one reader and `[D` the other — the frame's caret is drawn by a
 * renderer that no longer owns the screen, and terminal query replies left in
 * the canonical buffer are read by the shell as commands (`62`, `22t`, `52c`).
 * That is exactly what a `/remote` switch from a source checkout produced.
 *
 * Keeping the child in this process's group (no `detached`) and waiting here
 * leaves exactly one owner of the terminal across the swap: the foreground
 * process group never changes, and the shell only comes back when the whole
 * chain has exited.
 * @param command - executable to run.
 * @param args - its arguments.
 * @returns the child's exit code, or 1 when it died by signal or could not start.
 */
export async function spawnHandoff(command: string, args: readonly string[]): Promise<number> {
  return await new Promise<number>(resolve => {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, [...args], {
        stdio: ['inherit', 'inherit', 'inherit'],
        env: { ...process.env },
      })
    } catch {
      resolve(1)
      return
    }
    const forward = (signal: NodeJS.Signals): void => {
      try { child.kill(signal) } catch { /* already gone */ }
    }
    const cleanUp = (): void => {
      for (const signal of signals) process.off(signal, forward)
    }
    for (const signal of signals) process.on(signal, forward)
    child.once('error', () => { cleanUp(); resolve(1) })
    child.once('close', (code, signal) => {
      cleanUp()
      resolve(signal !== null ? 1 : code ?? 1)
    })
  })
}
