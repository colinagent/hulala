/**
 * `node-pty` loader for the columns beside the transcript.
 *
 * The client ships as one Node ESM bundle, but `node-pty` is a native module, so it
 * can never be inlined. Three install layouts are supported, in order:
 *
 * 1. normal resolution — the repo workspaces and `npm i -g hulala` both put it
 *    next to the bundle;
 * 2. the packaged release archive, which already installs `node-pty` under
 *    `runtime/node_modules` for the Host's subprocess provider
 *    (`scripts/release/packageRelease.ts` lists it in `trustedDependencies`), so the
 *    terminal and editor columns cost no extra platform package;
 * 3. Bun, where `node-pty` silently never delivers output or exit events, so
 *    the built-in `Bun.spawn({ terminal })` pty is adapted instead.
 *
 * Resolution is deliberately dynamic: a build-time import of a native module
 * would either fail the bundle or pin the client to one platform.
 *
 * @module hulala-cli/tui/editor/pty
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One spawned pty, narrowed to what a column uses. */
export interface PtyProcess {
  readonly pid: number
  onData(handler: (data: string) => void): void
  onExit(handler: (event: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

/** Spawn options; only the fields the editor sets. */
export interface PtySpawnOptions {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string | undefined>
}

/** The narrow surface both pty backends implement. */
export interface PtyModule {
  spawn(file: string, args: string[], options: PtySpawnOptions): PtyProcess
}

/** Directory that contains `bin/` and `runtime/` in a packaged archive. */
function packageRoot(): string {
  // Dev: <cli>/dist/hulala.mjs or <cli>/src/tui/editor/pty.ts. Packaged:
  // <package>/bin/hulala. Only the packaged layout has a sibling `runtime/`.
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

function loadFrom(base: string): PtyModule | undefined {
  try {
    return createRequire(join(base, 'package.json'))('node-pty') as PtyModule
  } catch {
    return undefined
  }
}

/**
 * Adapt `Bun.spawn({ terminal })` to the same surface as `node-pty`.
 *
 * Bun resolves `node-pty` but never runs its native read path, so the editor
 * column would stay blank forever. Bun's own pty does deliver output, and this
 * keeps `bun run dev` usable without changing the bundled Node client.
 * @returns the adapter, or undefined outside Bun.
 */
function bunPty(): PtyModule | undefined {
  if (process.versions.bun === undefined) return undefined
  return {
    spawn(file, args, options) {
      let deliver: ((data: string) => void) | undefined
      const pending: Uint8Array[] = []
      const decoder = new TextDecoder()
      const proc = Bun.spawn([file, ...args], {
        cwd: options.cwd,
        env: options.env,
        terminal: {
          cols: options.cols,
          rows: options.rows,
          name: options.name,
          data: (terminal, chunk) => {
            // Bun may deliver the first paint before `onData` is attached.
            if (deliver === undefined) {
              pending.push(chunk.slice())
              return
            }
            deliver(decoder.decode(chunk, { stream: true }))
          },
        },
      })
      const terminal = proc.terminal
      return {
        pid: proc.pid,
        onData(handler) {
          deliver = handler
          for (const chunk of pending.splice(0)) handler(decoder.decode(chunk, { stream: true }))
        },
        onExit(handler) {
          void proc.exited.then(exitCode => { handler({ exitCode }) })
        },
        write(data) {
          terminal?.write(data)
        },
        resize(cols, rows) {
          terminal?.resize(cols, rows)
        },
        kill() {
          proc.kill()
        },
      }
    },
  }
}

/**
 * Load a pty backend for the running runtime, or `undefined` when none is
 * available so the caller can explain instead of painting an empty column.
 * @returns the pty module, or undefined when unavailable.
 */
export function loadNodePty(): PtyModule | undefined {
  const bun = bunPty()
  if (bun !== undefined) return bun
  // Normal resolution walks up from this file, which covers the repo
  // workspaces and a global npm install. The packaged release archive keeps its
  // dependencies in a sibling `runtime/` directory instead.
  return loadFrom(dirname(fileURLToPath(import.meta.url)))
    ?? loadFrom(packageRoot())
    ?? loadFrom(join(packageRoot(), 'runtime'))
    ?? undefined
}
