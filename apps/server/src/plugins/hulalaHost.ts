/**
 * Hulala Host assembly.
 *
 * The public Runtime already composes the DeepSeek Harness engine. This plugin
 * adds only what the Harness does not own: the daemon's readiness route, the
 * two product gap plugins, and the endpoint facts every client needs to attach.
 * HTTP, WebSocket, `/connect`, `/api` and authentication belong to
 * `dsh-host-webserver` + `dsh-client-connection`; no second REST layer is
 * mounted here.
 *
 * @module hulala-server/host-plugin
 */
import type { Context } from '@deepseek-ai/cordis'
import { apply as apiRemotes } from '@deepseek-ai/dsh-api-remotes'
import { apply as connectionPlugin } from '@deepseek-ai/dsh-client-connection'
import { WebServer, isLoopbackHost } from '@deepseek-ai/dsh-host-webserver'
import { HOST_DAEMON_PROTOCOL, type ConnectionDescriptor } from '@hulala/desktop-contracts'
import type { HulalaPaths } from '@hulala/desktop-contracts'
import { ensureHulalaPaths, type ServerConfig } from '../config.ts'
import { apiFilesPlugin } from './apiFiles.ts'
import { apiGitPlugin } from './apiGit.ts'

/** Host transport facts exposed to sibling plugins and the Host bootstrap. */
export interface HulalaHostService {
  readonly descriptor: ConnectionDescriptor
  readonly paths: HulalaPaths
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    hulalaHost: HulalaHostService
  }
}

/** Stable plugin name used by lifecycle diagnostics. */
export const name = 'hulala-host'

/** Mount the DSH web carrier when the profile did not already provide it. */
async function ensureWebServer(ctx: Context, port: number): Promise<WebServer> {
  if (ctx.get('webServer') === undefined) {
    await ctx.plugin(WebServer, { host: '127.0.0.1', port })
  }
  const webServer = ctx.get('webServer')
  if (webServer === undefined) throw new Error('Hulala Host could not mount the Harness web server')
  // A profile must not turn the product Host into a LAN service by accident.
  if (!isLoopbackHost(webServer.host)) throw new Error(`Hulala Host requires a loopback web server, not ${webServer.host}`)
  return webServer
}

/** Mount DSH's authenticated Connection transport when it is absent. */
async function ensureConnection(ctx: Context): Promise<void> {
  if (ctx.get('connection') === undefined) await ctx.plugin(connectionPlugin, {})
  if (ctx.get('connection') === undefined) throw new Error('Hulala Host could not mount the Harness Connection transport')
}

/**
 * Own the public Hulala Host as one Cordis plugin.
 *
 * @param ctx - Host plugin context after the public Runtime settled.
 * @param config - Resolved Host configuration from process inputs.
 */
export async function apply(ctx: Context, config: ServerConfig): Promise<void> {
  const paths = await ensureHulalaPaths(config.hulalaRoot, config.workspaceRoot)
  const webServer = await ensureWebServer(ctx, config.port)
  await ensureConnection(ctx)
  const connection = ctx.get('connection')
  if (connection === undefined) throw new Error('Hulala Host has no Connection transport')

  // The launch token stays inside DSH; read it back from the authenticated URL
  // rather than minting a second credential the transport would reject.
  const httpUrl = webServer.getOrigin()
  const authenticated = new URL(connection.authenticatedUrl(httpUrl))
  const token = authenticated.searchParams.get('token')
  if (token === null || token.length < 32) throw new Error('Hulala Host could not read the Harness launch token')

  const instanceId = crypto.randomUUID()
  const startedAt = new Date().toISOString()
  const descriptor: ConnectionDescriptor = {
    httpUrl,
    eventsUrl: `${httpUrl.replace(/^http/u, 'ws')}/api/remote.mux`,
    token,
    instanceId,
    // Retained in the endpoint contract for clients that still publish a
    // resource cookie; DSH authentication uses the `/connect` exchange instead.
    authCookieName: `hulala_${instanceId.replace(/[^A-Za-z0-9]/gu, '_')}`,
  }

  const health = {
    name: 'hulala-desktop-server' as const,
    protocol: HOST_DAEMON_PROTOCOL,
    version: config.version,
    instanceId,
    pid: process.pid,
    startedAt,
    runtime: { state: 'running' as const },
  }
  ctx.effect(
    () => webServer.register({
      kind: 'exact',
      path: '/health',
      handler: (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify(health))
      },
    }),
    'hulala-host: readiness route',
  )

  await ctx.plugin({ apply: apiRemotes, inject: ['typertGateway'] })
  await ctx.plugin(apiFilesPlugin)
  // Git needs the subprocess provider, which can settle after the HTTP carrier is
  // ready; the Gateway discovers the service once it registers.
  ctx.plugin(apiGitPlugin)
  ctx.provide('hulalaHost', { descriptor, paths })
}

/** Cordis object-form plugin used by the Host bootstrap. */
export const hulalaHostPlugin = { name, apply }
