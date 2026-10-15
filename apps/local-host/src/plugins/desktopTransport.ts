import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionDescriptor, HulalaPaths } from '@hulala/workbench-contracts'
import type { ServerConfig } from '../config.ts'
import { createDesktopServer } from '../server.ts'
import { createHarnessNotifications } from '../harnessNotifications.ts'

/** Host transport facts exposed to sibling private Cordis plugins. */
export interface DesktopTransportService {
  readonly descriptor: ConnectionDescriptor
  readonly paths: HulalaPaths
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    hulalaDesktopTransport: DesktopTransportService
  }
}

/** Stable private plugin name used by lifecycle diagnostics. */
export const name = 'hulala-desktop-transport'

/**
 * Own the current authenticated Desktop HTTP/WebSocket carrier as one Cordis
 * effect. Later migration stages replace its internal routes without changing
 * the Host lifecycle or the service consumed by sibling private plugins.
 * @param ctx - Private Host plugin context.
 * @param config - Resolved Desktop Host configuration.
 */
export async function apply(ctx: Context, config: ServerConfig): Promise<void> {
  const server = await createDesktopServer(config, {
    agents: ctx.get('agents'),
    agentPresets: ctx.get('agentPresets'),
    agentDefaultModel: ctx.get('agentDefaultModel'),
    llm: ctx.get('llm'),
    notifications: ctx.get('sessionController') ? createHarnessNotifications(ctx) : undefined,
    typertGateway: ctx.get('typertGateway'),
    agentLoopSelector: ctx.get('agentLoopSelector'),
    authorization: ctx.get('authorization'),
    credentials: ctx.get('credentials'),
    attachments: ctx.get('attachments'),
    sessions: ctx.get('sessions'),
    sessionPersistence: ctx.get('sessionPersistence'),
    workspaceRegistry: ctx.get('workspaceRegistry'),
    fs: ctx.get('fs'),
    subprocess: ctx.get('subprocess'),
    productDatabase: ctx.get('hulalaProductDatabase'),
    localPlugins: ctx.get('hulalaLocalPlugins'),
  })
  ctx.provide('hulalaDesktopTransport', {
    descriptor: server.descriptor,
    paths: server.paths,
  })
  ctx.effect(
    () => () => server.stop(),
    'hulala-desktop-transport: stop authenticated carrier',
  )
}

/** Cordis object-form plugin used by the private Host bootstrap. */
export const desktopTransportPlugin = { name, inject: ['hulalaProductDatabase'], apply }
