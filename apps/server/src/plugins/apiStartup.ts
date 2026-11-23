/**
 * `hulala-api-startup` — the MCP servers the open Session will mount.
 *
 * The welcome block under the banner names what a Session loaded. Skills are a
 * Harness Remote already (`skills.list`), so they are not repeated here; MCP has
 * none — `@colinagent/dsh-mcp` mounts one `dsh-mcp-client` per Agent from two
 * documents and publishes no inventory — and this route is that answer.
 *
 * The documents are resolved with the bundle's own `resolveRoster`, not with a
 * second reading of the merge rules, so the block cannot disagree with what
 * mounts: the same project override, the same `enabled: false`, the same
 * rejected entries. Reading them connects to nothing, which is the point of a
 * startup block: a server that later fails to start is still one the Session
 * was configured for, and saying so is honest.
 *
 * The directory comes from the Session, never from the client: behind
 * `hulala ssh` the window's paths name another machine, and only the Host knows
 * where its Agent runs. Reading it goes through `sessionQuery`, so a Session
 * that is not live yet is restored from its log instead of being resumed.
 *
 * The route carries the same fence as the paste route (loopback, the Host's
 * own `Origin`/host checks, the connection cookie) and answers with names only.
 *
 * @module hulala-server/api-startup
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { resolveRoster } from '@colinagent/dsh-mcp'
import type { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-working-directory'

/**
 * Per-server defaults the mounted MCP row applies when an entry omits them.
 *
 * They are the bundle's own defaults (`@colinagent/dsh-mcp` `Config`), repeated
 * because a name list does not depend on a timeout: only `enabled`, the declared
 * transport and the entry's validity decide whether a server is listed.
 */
const DEFAULTS = { toolCallTimeoutMs: 60_000, closeTimeoutMs: 5_000 } as const

/** The two documents the MCP bundle reads, by its own default layout. */
export interface McpDocumentPaths {
  readonly user: string
  readonly project: string
}

/**
 * Where the bundle looks for a Session's MCP documents.
 *
 * The bundle's default layout: its row in this profile carries no config, and a
 * row that changed `userFile` or `scanProject` would be the one place this read
 * disagrees with it. Reading the shipped defaults is what keeps the roster
 * identical to the one the plugin resolves.
 * @param cwd - the Session's effective directory.
 * @param home - the Host user's home directory.
 * @returns both absolute paths, whether or not they exist.
 */
export function mcpDocumentPaths(cwd: string, home: string): McpDocumentPaths {
  return {
    user: join(home, '.agents', 'mcp.json'),
    project: join(cwd, '.agents', 'mcp.json'),
  }
}

/**
 * The server names one Session's documents resolve to.
 *
 * `resolveRoster` is pure, so this is the whole merge policy in one call: the
 * project file overrides the user file by name, an `enabled`-only project entry
 * toggles the inherited one, and an entry the plugin would refuse is not listed.
 * @param input - both parsed documents, the Session directory, and the home
 *   directory relative `cwd` values resolve against.
 * @returns server names, sorted the way the bundle sorts its roster.
 */
export function startupMcpServers(input: {
  readonly user?: unknown
  readonly project?: unknown
  readonly cwd: string
  readonly home: string
}): string[] {
  const roster = resolveRoster({
    ...(input.user === undefined ? {} : { user: input.user }),
    ...(input.project === undefined ? {} : { project: input.project }),
    cwd: input.cwd,
    home: input.home,
    defaults: DEFAULTS,
  })
  return roster.servers.map(server => server.name)
}

/**
 * Parse one MCP document.
 *
 * A missing file and a file that is not JSON are both "no servers": the block is
 * a reminder, and a broken document is the mounting plugin's diagnostic to
 * report, not a reason for this route to fail.
 * @param path - absolute document path.
 * @returns the parsed value, or undefined when there is nothing to read.
 */
async function readDocument(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8').catch(() => undefined)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Answer one request with JSON. */
function respond(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

/**
 * The Session this request asks about.
 * @param url - the request line's path and query.
 * @returns the Session id, or undefined when the request names none.
 */
function sessionOf(url: string | undefined): SessionId | undefined {
  const value = new URL(url ?? '', 'http://localhost').searchParams.get('session')
  if (value === null || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) return undefined
  return value as SessionId
}

/** Stable Cordis plugin name. */
export const name = 'hulala-api-startup'

/** Cordis plugin object loaded by the Host assembly. */
export const apiStartupPlugin = {
  name,
  inject: ['webServer', 'connection', 'sessionQuery', 'workingDirectory'],
  apply(ctx: Context): void {
    const webServer = ctx.get('webServer') as WebServer
    const connection = ctx.get('connection') as HostConnectionService
    const sessionQuery = ctx.sessionQuery
    const workingDirectory = ctx.workingDirectory
    // Resolved once, from this process: the documents belong to the machine the
    // Agent's tools run on, which is this one.
    const home = homedir()

    ctx.effect(
      () => webServer.register({
        kind: 'exact',
        path: '/api/startup',
        handler: async (request: IncomingMessage, response: ServerResponse) => {
          const rejection = connection.requestRejection({ headers: request.headers })
          if (rejection !== undefined) {
            response.writeHead(rejection, { 'content-type': 'text/plain' })
            response.end('Unauthorized')
            return
          }
          if (request.method !== 'GET') {
            respond(response, 405, { message: 'GET only' })
            return
          }
          const session = sessionOf(request.url)
          if (session === undefined) {
            respond(response, 400, { message: 'session is required' })
            return
          }
          // The directory is a property of the Session, so it is read from there:
          // a cold Session is observed from its log, not resumed for a reminder.
          const cwd = await sessionQuery
            .inspectSession(session, value => workingDirectory.get(value))
            .catch(() => undefined)
          if (cwd === undefined) {
            respond(response, 404, { message: 'session not found' })
            return
          }
          const paths = mcpDocumentPaths(cwd, home)
          const [user, project] = await Promise.all([
            readDocument(paths.user),
            readDocument(paths.project),
          ])
          try {
            respond(response, 200, { mcp: startupMcpServers({ user, project, cwd, home }) })
          } catch (error) {
            respond(response, 500, { message: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      'hulala-api-startup: route',
    )
  },
}
