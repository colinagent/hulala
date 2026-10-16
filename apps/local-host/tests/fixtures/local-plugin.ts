import type { PluginBackendContext } from '@hulala/plugin-sdk'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const unknown = { parse: (value: unknown) => value }
export async function activate(context: PluginBackendContext) {
  const settings = await context.settings.read() as { count?: number }
  const count = (settings.count ?? 0) + 1
  await context.settings.write({ count })
  context.onDispose(() => writeFile(join(context.dataDir, 'disposed'), 'yes'))
  context.rpc.register('count', unknown, unknown, () => count)
  context.rpc.register('wait', unknown, unknown, () => new Promise(resolve => context.signal.addEventListener('abort', () => resolve('aborted'), { once: true })))
  context.rpc.register('validated', { parse: value => { if (typeof value !== 'number') throw new Error('number required'); return value } }, unknown, value => value + 1)
  context.rpc.register('secret-probe', unknown, unknown, async action => {
    const value = await context.secrets.resolve('token')
    if (action === 'settings') { await context.settings.write({ value }); return true }
    if (action === 'events') { context.events.emit('probe.secret', unknown, { value }); context.log('info', 'Configured: ' + value); return true }
    return { value }
  })
}
