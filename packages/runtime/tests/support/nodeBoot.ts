/**
 * Spawn the Host under Node for a test.
 *
 * DSH's profile boot needs Node's V8 internals (it patches the ESM/CJS loaders
 * through a native addon), so a Host booted by `bun test` would fail before the
 * first plugin mounts. The driver is bundled once by Bun, run by Node, and
 * reports what the booted tree exposes; the test asserts against that report.
 *
 * @module hulala/runtime-tests/nodeBoot
 */
import { spawn } from 'node:child_process'
import { mkdtemp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Published packages stay external, exactly as the production Host build leaves them. */
const EXTERNALS = ['@deepseek-ai/*', 'zod', 'ws', 'undici', 'koffi', 'sharp', 'miniflare']

/** Repository root that contains this package; the driver's install anchor. */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

/** What the driver reports about the booted Host. */
export interface NodeBootReport {
  readonly state: string
  readonly services: Record<string, boolean>
  readonly webServerPort?: number
  readonly authorizationKeys: readonly string[]
}

/** A Host running in its own Node process. */
export interface NodeBoot {
  readonly report: NodeBootReport
  stop(): Promise<void>
}

let built: Promise<string> | undefined

/**
 * Bundle the driver once per test run.
 *
 * The output sits in a temporary directory with a `node_modules` link to this
 * repository, so the externally kept packages resolve from the real install.
 * @returns the absolute path of the bundled driver.
 */
function driver(): Promise<string> {
  return built ??= (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hulala-node-driver-'))
    await symlink(join(REPOSITORY_ROOT, 'node_modules'), join(directory, 'node_modules'), 'dir')
    const result = await Bun.build({
      entrypoints: [fileURLToPath(new URL('./driver.ts', import.meta.url))],
      outdir: directory,
      naming: '[name].mjs',
      target: 'node',
      format: 'esm',
      external: EXTERNALS,
    })
    if (!result.success) throw new AggregateError(result.logs, 'failed to bundle the Node Host driver')
    return join(directory, 'driver.mjs')
  })()
}

/**
 * Boot one Host under Node and wait for its report.
 * @param options - injected state root and the service names to report.
 * @returns the report plus the stop handle that ends the process.
 */
export async function bootInNode(options: { root: string; services?: readonly string[] }): Promise<NodeBoot> {
  const entry = await driver()
  const spec = JSON.stringify({ repositoryRoot: REPOSITORY_ROOT, root: options.root, services: options.services ?? [] })
  const child = spawn('node', [entry, spec], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  let stdout = ''
  child.stdout.setEncoding('utf8')

  const report = await new Promise<NodeBootReport>((resolve, reject) => {
    let settled = false
    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      child.removeAllListeners('exit')
      action()
    }
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      // The Host also writes plain-text lines (DSH's own URL banner), so the
      // report is the first line that parses as one.
      for (const line of stdout.split('\n').slice(0, -1)) {
        if (!line.startsWith('{')) continue
        let parsed: NodeBootReport
        try {
          parsed = JSON.parse(line) as NodeBootReport
        } catch {
          continue
        }
        settle(() => resolve(parsed))
        return
      }
      stdout = stdout.slice(stdout.lastIndexOf('\n') + 1)
    })
    child.once('exit', (code) => {
      settle(() => reject(new Error(`Node Host driver exited with code ${String(code)} before reporting:\n${stderr}`)))
    })
    child.once('error', error => settle(() => reject(error)))
  })

  let stopping: Promise<void> | undefined
  return {
    report,
    stop: () => stopping ??= (async () => {
      const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()) })
      child.stdin.write('stop\n')
      child.stdin.end()
      await exited
    })(),
  }
}
