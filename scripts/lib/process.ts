/**
 * Child-process helpers shared by the build and release scripts.
 *
 * These replace Bun's `spawn` sugar: every caller wants either inherited stdio
 * or captured output, plus a numeric exit code instead of a promise property.
 *
 * @module hulala/scripts/lib/process
 */
import { spawn, type SpawnOptions } from 'node:child_process'

/** How a child's stdio is wired. */
export type RunStdio = 'inherit' | 'capture' | 'ignore'

/** Options accepted by {@link run}. */
export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdio?: RunStdio
}

/** Captured output from one child process. */
export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Run a child process and wait for it to exit.
 * @param command - executable name or path.
 * @param args - arguments passed verbatim.
 * @param options - working directory, environment and stdio wiring.
 * @returns captured output (empty unless `stdio` is `capture`) and the exit code.
 */
export function run(command: string, args: readonly string[] = [], options: RunOptions = {}): Promise<RunResult> {
  const stdio = options.stdio ?? 'inherit'
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: stdio === 'capture' ? ['ignore', 'pipe', 'pipe'] : stdio,
  }
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, spawnOptions)
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 1), stdout, stderr })
    })
  })
}

/**
 * Run a child process and fail unless it succeeds.
 * @param command - executable name or path.
 * @param args - arguments passed verbatim.
 * @param options - working directory, environment and stdio wiring.
 * @returns the captured output of a successful run.
 */
export async function runOrThrow(
  command: string,
  args: readonly string[] = [],
  options: RunOptions = {},
): Promise<RunResult> {
  const result = await run(command, args, options)
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(`${command} ${args.join(' ')} exited with ${result.code}${detail ? `: ${detail}` : ''}`)
  }
  return result
}
