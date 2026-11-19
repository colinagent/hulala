/**
 * Node-side Host boot driver for the runtime tests.
 *
 * DSH's own profile boot (`runProfile`) mounts plugin packages through a native
 * addon that reads Node's V8 internals, so the Host cannot boot inside Bun. The
 * production Host is a Node program — `apps/cli` starts `node hulala-host.mjs` —
 * so the tests boot it the same way: this driver is bundled by Bun and run by
 * Node, and reports what the booted tree exposes.
 *
 * Protocol: argv[2] is a JSON spec, one report line on stdout, then the driver
 * waits for `stop` on stdin before shutting the Host down.
 *
 * @module hulala/runtime-tests/driver
 */
import type {} from '@deepseek-ai/dsh-authorization'
import { bootRepositoryHarness } from '../../src/in-process.js'

/** What one test asks the driver to report. */
interface DriverSpec {
  /** Repository root whose package.json anchors the DSH runtime. */
  repositoryRoot: string
  /** Injected Hulala state root. */
  root: string
  /** Service names the test inspects on the booted context. */
  services?: readonly string[]
}

/** The report the test reads back. */
interface DriverReport {
  state: string
  services: Record<string, boolean>
  webServerPort?: number
  authorizationKeys: string[]
}

const spec = JSON.parse(process.argv[2] ?? '{}') as DriverSpec

try {
  const runtime = await bootRepositoryHarness({
    repositoryRoot: spec.repositoryRoot,
    paths: { root: spec.root },
    environment: { DSH_TELEMETRY_DISABLED: '1' },
  })
  const webServer = runtime.ctx.get('webServer') as { port?: number } | undefined
  const report: DriverReport = {
    state: runtime.state(),
    services: Object.fromEntries((spec.services ?? []).map(name => [name, runtime.ctx.get(name) !== undefined])),
    ...(webServer?.port === undefined ? {} : { webServerPort: webServer.port }),
    authorizationKeys: runtime.ctx.authorization.list().map(entry => entry.key),
  }
  process.stdout.write(`${JSON.stringify(report)}\n`)
  // A parent that dies must not leave a Host running behind the test run.
  const received = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 120_000)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk: string) => {
      if (!chunk.includes('stop')) return
      clearTimeout(timer)
      resolve()
    })
    process.stdin.on('end', () => { clearTimeout(timer); resolve() })
  })
  await received
  await runtime.stop()
  process.exit(0)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exit(1)
}
