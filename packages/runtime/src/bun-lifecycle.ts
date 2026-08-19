import type { Context } from '@deepseek-ai/cordis'

export const name = 'loopwithai-bun-lifecycle'

/**
 * DSH dynamically adds its Node-internal HMR service when none is present.
 * Bun does not expose Node's internal ESM loader, and production LoopWithAI
 * profiles do not hot-reload host plugins, so this marker owns that optional
 * service slot and keeps the DSH lifecycle on its normal no-HMR path.
 */
export function apply(ctx: Context): void {
  ctx.provide('hmr', Object.freeze({
    runtime: 'bun',
    reload: false,
    async registerConfig(): Promise<() => Promise<void>> {
      return async () => undefined
    },
  }))
}
