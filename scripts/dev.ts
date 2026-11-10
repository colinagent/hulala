/**
 * The development start: stop the Host, rebuild it, rebuild the client, run the
 * client's build.
 *
 * A source checkout has no version to compare — the working tree and the
 * installed release both report the package version — so "run the latest Host"
 * can only mean "replace the daemon with a build of this checkout". The
 * installed `hulala` command deliberately attaches to a healthy Host and only
 * replaces it through `hulala update`; this script is the explicit dev action
 * that stops the shared daemon first.
 *
 * The order is the owner's dev rule: stop, build, run. A failed build therefore
 * leaves no Host running and does not start a client against a stale one, and
 * the client is never started from source: it runs `apps/cli/dist/hulala.mjs`,
 * the same bundle the release copies to `bin/hulala`.
 *
 * @module hulala/scripts/dev
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The four actions, injectable so the order is testable without processes. */
export interface DevSteps {
  /** Stop the Host that owns this state root; `absent` means none ran. */
  stopHost(): Promise<'absent' | 'stopped'>
  /** Build the Host from the current source; resolves to the process exit code. */
  buildHost(): Promise<number>
  /** Build the terminal client from the current source; resolves to the exit code. */
  buildClient(): Promise<number>
  /** Run the built terminal client; resolves to the process exit code. */
  runClient(args: string[]): Promise<number>
}

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Stop the running Host, rebuild it, rebuild the client, then run the client's
 * build.
 *
 * No version check happens here: dev always replaces the daemon, and the client
 * runs the bundle the release ships (`apps/cli/dist/hulala.mjs`) rather than the
 * source entry, so what starts here is what `bin/hulala` will run. A build
 * failure stops the sequence instead of falling back to the previous bundle.
 * The packaged `hulala` path is cleared so a shell that inherited an installed
 * launcher's environment cannot send the client back to the release Host.
 * @param args - terminal client arguments, after `bun run start --`.
 * @param steps - process actions; tests inject recorders.
 * @returns the client's exit code, or the build's on failure.
 */
export async function devStart(args: readonly string[], steps: DevSteps): Promise<number> {
  delete process.env.HULALA_PACKAGE_ROOT

  console.log('dev: stopping the running Hulala Host…')
  try {
    const stopped = await steps.stopHost()
    console.log(stopped === 'stopped' ? 'dev: Host stopped.' : 'dev: no Host was running.')
  } catch (error) {
    console.error(`dev: could not stop the Host: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  console.log('dev: building the Host from the current source…')
  let built: number
  try {
    built = await steps.buildHost()
  } catch (error) {
    console.error(`dev: Host build failed: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  if (built !== 0) {
    console.error('dev: Host build failed; the client was not started.')
    return built
  }

  console.log('dev: building the terminal client from the current source…')
  let compiled: number
  try {
    compiled = await steps.buildClient()
  } catch (error) {
    console.error(`dev: client build failed: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  if (compiled !== 0) {
    console.error('dev: client build failed; the client was not started.')
    return compiled
  }

  console.log('dev: starting the client build…')
  try {
    return await steps.runClient([...args])
  } catch (error) {
    console.error(`dev: client failed to start: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

/** The real process actions, loaded lazily so tests do not import the client. */
async function defaultSteps(): Promise<DevSteps> {
  return {
    stopHost: async () => {
      const { stopHost } = await import('../apps/cli/src/hostAttach.js')
      return await stopHost()
    },
    buildHost: async () => {
      const child = Bun.spawn([process.execPath, 'run', '--cwd', 'apps/server', 'build'], {
        cwd: repositoryRoot,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      })
      return await child.exited
    },
    buildClient: async () => {
      // Inline sourcemaps keep a stack trace pointing at the source while the
      // release build stays map-free.
      const child = Bun.spawn([process.execPath, 'run', '--cwd', 'apps/cli', 'build:client'], {
        cwd: repositoryRoot,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
        env: { ...process.env, HULALA_TUI_SOURCEMAP: '1' },
      })
      return await child.exited
    },
    runClient: async args => {
      // Run the built bundle rather than importing the source: `process.argv[1]`
      // must stay a real entry point, because `/update` re-invokes it, and the
      // editor's Mermaid renderer runs it too. This is also the artifact the
      // release copies to `bin/hulala`.
      const child = Bun.spawn([process.execPath, join(repositoryRoot, 'apps/cli/dist/hulala.mjs'), ...args], {
        cwd: repositoryRoot,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      })
      const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
      const forward = (signal: NodeJS.Signals): void => {
        try {
          child.kill(signal)
        } catch {
          // The child is already gone.
        }
      }
      for (const signal of signals) process.on(signal, forward)
      try {
        return await child.exited
      } finally {
        for (const signal of signals) process.off(signal, forward)
      }
    },
  }
}

if (import.meta.main) {
  process.exitCode = await devStart(process.argv.slice(2), await defaultSteps())
}
