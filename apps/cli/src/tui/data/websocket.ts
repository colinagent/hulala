/**
 * The `ws` client, loaded at runtime instead of bundled.
 *
 * `ws` is a Node library with optional native helpers and dynamic requires. When
 * the TUI bundle inlines it, the client's multiplex connection starts fine and
 * then drops the moment a second stream (a terminal column attaching) needs the
 * socket — the bundled copy is not the `ws` the runtime resolves. Externalising
 * it would work in a source checkout and fail in the release archive, whose
 * dependency tree lives under `runtime/node_modules`, outside ESM's search path.
 *
 * So this is the same resolution shape `editor/pty.ts` uses for `node-pty`:
 * normal resolution first (source, npm package, dev bundle), then the packaged
 * `runtime/` tree. The bundle never contains `ws`, and the artifact and the
 * checkout run the same library.
 *
 * @module hulala-cli/tui/data/websocket
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type WebSocketClass from 'ws'

/** Directory of this module, or of the bundle that inlined it. */
const here = dirname(fileURLToPath(import.meta.url))

/** Candidate roots, closest first: the module, its package, packaged runtime. */
const ROOTS = [
  here,
  dirname(here),
  join(dirname(here), 'runtime'),
]

/** The constructor once found; the search runs at most once per process. */
let resolved: typeof WebSocketClass | undefined

/**
 * Resolve the real `ws` constructor.
 *
 * A missing library is a packaging bug, not a runtime condition: failing here
 * with the paths tried is what turns a mysterious reconnect loop into an
 * actionable error.
 *
 * The search is deferred to the first connection on purpose. The release
 * archive carries code only, so `ws` does not exist until the package's own
 * `hulala install` has run `npm ci`; resolving at module load made every
 * command in a freshly unpacked archive — `--version`, `install`, the
 * installer's own handoff — die before it could install the tree.
 * @returns the `ws` WebSocket class.
 */
export function webSocketClass(): typeof WebSocketClass {
  if (resolved !== undefined) return resolved
  for (const root of ROOTS) {
    try {
      resolved = createRequire(join(root, 'package.json'))('ws') as typeof WebSocketClass
      return resolved
    } catch {
      // Try the next layout.
    }
  }
  throw new Error(`ws not found beside ${here}; tried ${ROOTS.join(', ')}`)
}
