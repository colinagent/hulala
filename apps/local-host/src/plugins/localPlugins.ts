import type { Context } from '@deepseek-ai/cordis'
import { LocalPluginManager } from '../localPlugins/manager.ts'
import { localPluginServices } from '../localPlugins/services.ts'
declare module '@deepseek-ai/cordis' { interface Context { hulalaLocalPlugins: LocalPluginManager } }
export const localPluginsPlugin = {
  name: 'hulala-local-plugins',
  async apply(ctx: Context, config: { root: string; workspaceId?: string }) {
    const manager = new LocalPluginManager(config.root, ctx, localPluginServices(ctx), config.workspaceId)
    ctx.effect(() => () => manager.stop(), 'local plugins: stop')
    await manager.initialize()
    ctx.provide('hulalaLocalPlugins', manager)
  },
}
