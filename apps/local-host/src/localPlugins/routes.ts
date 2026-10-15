import type { LocalPluginManager } from './manager.ts'
import { z } from 'zod'
import { json, parseJson, HttpError } from '../http.ts'
import { pluginIdSchema } from './manifest.ts'
const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('install'), path: z.string().min(1).max(4096) }).strict(),
  z.object({ action: z.literal('enable'), id: pluginIdSchema, enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('uninstall'), id: pluginIdSchema }).strict(),
  z.object({ action: z.literal('rollback'), id: pluginIdSchema, revision: z.string().uuid() }).strict(),
  z.object({ action: z.literal('rpc'), id: pluginIdSchema, method: z.string().max(80), input: z.unknown().optional() }).strict(),
  z.object({ action: z.literal('secret'), id: pluginIdSchema, name: z.string().max(80), value: z.string().max(8192).optional() }).strict(),
])
export async function pluginRoute(manager: LocalPluginManager | undefined, path: string, request: Request): Promise<Response> {
  if (!manager) throw new HttpError(503, 'plugins_unavailable', 'Local plugins are unavailable')
  const url = new URL(request.url)
  if (path === '/plugins' && request.method === 'GET') return json(manager.list())
  if (path === '/plugins/events' && request.method === 'GET') return json(manager.events(Math.max(0, Number(url.searchParams.get('after')) || 0)))
  if (path === '/plugins' && request.method === 'POST') {
    const input = await parseJson(request, action)
    try { switch (input.action) {
      case 'install': return json(await manager.install(input.path))
      case 'enable': await manager.enable(input.id, input.enabled); return json({ ok: true })
      case 'rollback': return json(await manager.rollback(input.id, input.revision))
      case 'uninstall': await manager.uninstall(input.id); return json({ ok: true })
      case 'rpc': return json(await manager.rpc(input.id, input.method, input.input))
      case 'secret': await manager.setSecret(input.id, input.name, input.value); return json({ ok: true })
    } } catch (error) { throw new HttpError(400, 'plugin_operation_failed', manager.publicError('id' in input ? input.id : '', error)) }
  }
  const asset = path.match(/^\/plugins\/assets\/([^/]+)\/([^/]+)\/(.+)$/)
  if (asset && request.method === 'GET') {
    const file = await manager.asset(asset[1]!, asset[2]!, decodeURIComponent(asset[3]!))
    return new Response(Bun.file(file), { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  }
  throw new HttpError(404, 'route_not_found', 'Plugin route not found')
}
