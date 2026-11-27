/**
 * What this Host actually loaded, read from the live Loader.
 *
 * A composition is declared in the profile and realised at boot, and the two can
 * disagree without anything failing loudly: a bundle whose `link:` points at a
 * pruned runtime version simply never activates, the Host boots anyway, and the
 * only trace is one warning line on stderr. That is how `@colinagent/dsh-mcp`
 * stayed missing for eight days. `/health` therefore reports the roster, and
 * `degraded` names every entry that is not active so a client can say so without
 * reading a log file.
 *
 * DSH captures the same facts for a failed startup, but that capture is internal
 * to `@deepseek-ai/dsh-app-boot`, so this module reads the two public services it
 * reads: the Loader's entries and the `pluginPackages` resolution.
 *
 * @module hulala-server/composition
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { PROFILE_SKIPS_SERVICE } from '@hulala/runtime/host'
import type { PluginState } from '@hulala/host-client/node'

/** One bounded read of the live composition. */
export interface Composition {
  /** At most {@link MAX_ROWS} entries, failures first. */
  readonly plugins: readonly PluginState[]
  /** Entries that did not activate; empty means the declared suite loaded. */
  readonly degraded: readonly PluginState[]
}

/** A Host with more rows than this reports the first {@link MAX_ROWS}; the roster is a check, not an inventory. */
const MAX_ROWS = 128

/**
 * Packages this product composes itself: the bot and the MCP bridge are a suite,
 * not optional extras, so they are always in the roster even when the truncation
 * bound cuts the upstream rows.
 */
const SUITE_SCOPE = '@colinagent/'

/** Fiber state numbers, mirroring `@deepseek-ai/cordis`'s `FiberState`. */
const STATES: Record<number, string> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: 'disposed',
  5: 'unloading',
}

/**
 * The Loader entry shape, taken from the Loader itself so a change to it is a
 * type error here rather than a silent `unknown` row.
 */
type Entry = ReturnType<ReturnType<Context['loader']['entries']> extends Iterable<infer T> ? () => T : never>

/** One entry as reported: identity, resolved version, and the state DSH named. */
function stateOf(entry: {
  disabled: boolean
  fiber: { state: number } | undefined
}): string {
  if (entry.disabled) return 'disabled'
  if (entry.fiber === undefined) return 'failed'
  return STATES[entry.fiber.state] ?? 'unknown'
}

/**
 * Read the composition of one booted Host.
 * @param ctx - the Host's context, after the Loader mounted the composition.
 * @returns failed entries first, then the rest, capped at {@link MAX_ROWS}.
 */
export function readComposition(ctx: Context): Composition {
  // The Loader is a shadow accessor, not a service: a plugin's own fork cannot
  // read it, but the root context that mounted it always can. DSH's own startup
  // diagnostics read the same accessor from the context they were given.
  const loader = ctx.root.loader
  const packages = ctx.get('pluginPackages')
  const rows: PluginState[] = []
  for (const entry of loader.entries()) {
    const module = entry.options.name
    const state = stateOf(entry as { disabled: boolean, fiber: { state: number } | undefined })
    let version = 'unknown'
    try {
      const source = entry.parent.tree.ctx.baseUrl
      version = (source === undefined ? undefined : packages?.packageOf(module, source)?.version) ?? 'unknown'
    } catch {
      // Missing or damaged resolution metadata must not hide the row itself.
    }
    rows.push({ id: entry.id, module, version, state })
  }
  // Bundles the compatibility gate skipped never reach the Loader, so they are
  // not among `rows`; they are the one failure that happens before the tree is
  // mounted and the one a roster alone would miss.
  const skipped: PluginState[] = (ctx.get(PROFILE_SKIPS_SERVICE) ?? []).map(skip => ({
    id: `skipped:${skip.name}`,
    module: skip.name,
    version: 'unknown',
    state: 'skipped',
  }))
  const degraded = [
    ...skipped,
    ...rows.filter(row => row.state !== 'active' && row.state !== 'disabled'),
  ]
  const live = rows.filter(row => row.state === 'active')
  const suite = live.filter(row => row.module.startsWith(SUITE_SCOPE))
  const rest = live.filter(row => !suite.includes(row))
  return {
    // Failures and our own suite first: those are the rows a client acts on.
    plugins: [...degraded, ...suite, ...rest].slice(0, MAX_ROWS),
    degraded,
  }
}
