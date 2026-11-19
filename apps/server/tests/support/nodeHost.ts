/**
 * Run the built Host under Node for a test.
 *
 * DSH's profile boot patches Node's own module loaders through a native addon
 * that reads V8 internals, so a Host cannot boot inside Bun. Production runs the
 * built entry under Node (`node server/hulala-host.mjs`), and this helper does
 * the same thing with the same build: one `scripts/build-server.ts` run per test
 * file, then the real entry as a child process.
 *
 * @module hulala-server-tests/nodeHost
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The descriptor the Host prints once its authenticated transport listens. */
export interface HostReadyRecord {
  httpUrl: string
  eventsUrl: string
  token: string
  instanceId: string
  authCookieName: string
}

/** One built Host running in its own Node process. */
export interface NodeHost {
  readonly descriptor: HostReadyRecord
  /** Pid of the Host process, which is not the test runner's. */
  readonly pid: number
  stop(): Promise<void>
}

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const entry = join(packageRoot, 'dist', 'hulala-desktop-server.mjs')

let built: Promise<void> | undefined

/**
 * Build the Host entry once per test run, through the release build script so a
 * test never runs an artifact the release would refuse.
 * @returns the build's completion.
 */
function build(): Promise<void> {
  return built ??= (async () => {
    // `bun run` selects the version this repository pins in its root
    // `packageManager`, which is the one the release builds with; invoking the
    // script file directly would use whichever Bun the parent happens to be.
    const child = spawn(process.execPath, ['run', 'build'], { cwd: packageRoot, stdio: 'ignore' })
    const code = await new Promise<number | null>(resolve => child.once('exit', resolve))
    if (code !== 0) throw new Error(`build-server.ts exited with code ${String(code)}`)
    if (!existsSync(entry)) throw new Error(`Host entry was not built: ${entry}`)
  })()
}

/**
 * Boot the built Host against an injected state root.
 * @param options - state root, workspace root. Both are injected, never the real home.
 * @returns the printed descriptor plus the stop handle that ends the process.
 */
export async function bootHostInNode(options: { hulalaRoot: string; workspaceRoot: string }): Promise<NodeHost> {
  await build()
  const child = spawn('node', [
    entry,
    '--hulala-home', options.hulalaRoot,
    '--workspace-root', options.workspaceRoot,
    '--port', '0',
  ], { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] })
  let buffer = ''
  child.stdout.setEncoding('utf8')
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { stderr += chunk })

  const descriptor = await new Promise<HostReadyRecord>((resolve, reject) => {
    let settled = false
    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      child.removeAllListeners('exit')
      action()
    }
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      for (const line of buffer.split('\n').slice(0, -1)) {
        if (!line.startsWith('{')) continue
        const parsed = JSON.parse(line) as HostReadyRecord & { type?: string }
        if (parsed.type === 'hulala-server-ready' && typeof parsed.httpUrl === 'string') {
          settle(() => resolve(parsed))
          return
        }
      }
      // Keep the trailing partial line only.
      buffer = buffer.slice(buffer.lastIndexOf('\n') + 1)
    })
    child.once('exit', code => settle(() => reject(new Error(`Host exited with code ${String(code)} before becoming ready:\n${stderr}`))))
    child.once('error', error => settle(() => reject(error)))
  })

  let stopping: Promise<void> | undefined
  return {
    descriptor,
    pid: child.pid ?? -1,
    stop: () => stopping ??= (async () => {
      if (child.exitCode !== null) return
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
      child.kill('SIGTERM')
      await exited
    })(),
  }
}
