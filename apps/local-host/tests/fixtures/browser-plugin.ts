import type { PluginBackendContext } from '@hulala/plugin-sdk'
const any = { parse: (value: unknown) => value }
export async function activate(context: PluginBackendContext) {
  const old = await context.settings.read() as { starts?: number }
  const starts = (old.starts ?? 0) + 1
  await context.settings.write({ starts })
  let ticks = 0
  context.schedule(1000, () => context.events.emit('tick', any, { ticks: ++ticks, starts }))
  context.rpc.register('status', any, any, async () => ({ starts, ticks, credential: await context.secrets.describe('token') }))
  context.rpc.register('secret-test', any, any, async () => ({ value: await context.secrets.resolve('token') }))
}
