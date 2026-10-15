import type { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'

/** Stable private assembly name for the upstream Harness foundation. */
export const name = 'hulala-harness-foundation'

/**
 * Mount the first upstream Harness service inside the private Host. Later
 * stages extend this assembly with persistence, agents, API services, and the
 * remaining native providers instead of creating parallel implementations.
 * @param ctx - Private Host assembly context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(SessionStore)
}

/** Private Host assembly plugin for upstream Harness services. */
export const harnessFoundationPlugin = { name, apply }
