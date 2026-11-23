/**
 * The one export of `@colinagent/dsh-mcp` the Host reads.
 *
 * The package publishes its runtime bundle without declaration files, and the
 * startup route needs exactly its roster resolver: asking the mounting plugin to
 * resolve the two `mcp.json` documents is what keeps the welcome block's MCP
 * list and the servers that actually mount from being two implementations of the
 * same merge rules.
 *
 * Only the fields this Host passes and reads are declared. The shape is pinned by
 * `apps/server/tests/apiStartup.test.ts`, which calls the real module, so a
 * signature drift in that package fails a test instead of quietly returning an
 * empty list. When the package starts shipping its own declarations, delete this
 * file.
 *
 * @module hulala-server/types/dsh-mcp
 */

declare module '@colinagent/dsh-mcp' {
  /** One server the resolved roster would mount. */
  export interface RosterServer {
    readonly name: string
    readonly transport: 'stdio' | 'streamable-http'
    readonly origin: 'user' | 'project'
  }

  /** Both parsed documents plus the directory and home they resolve against. */
  export interface RosterInput {
    readonly user?: unknown
    readonly project?: unknown
    readonly cwd: string
    readonly home: string
    readonly defaults: {
      readonly toolCallTimeoutMs: number
      readonly closeTimeoutMs: number
      readonly startupTimeoutMs?: number
    }
  }

  /** What a Session would mount, and the entries that were skipped. */
  export interface RosterResult {
    readonly servers: readonly RosterServer[]
    readonly warnings: readonly string[]
  }

  /**
   * Merge the two documents into the server list one Session mounts.
   * @param input - both documents, the Session directory, home and defaults.
   * @returns the resolved servers, sorted by name.
   */
  export function resolveRoster(input: RosterInput): RosterResult
}
