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
 * exit — which is the point for a background download and for handing the
 * terminal to a freshly installed release. `unref` then lets this process exit
 * instead of waiting on it.
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
