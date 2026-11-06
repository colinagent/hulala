/**
 * The thinking level in effect for one route, and the levels it may take.
 *
 * A selection may carry an explicit `reasoningEffort` — the level the user
 * chose in `/model` or `/thinking` — but an untouched route still reasons:
 * DeepSeek Harness resolves an omitted effort with the adapter's default for
 * that model, and its own client shows exactly that pair
 * (`client/ui-model-selection`: `selection.reasoningEffort ?? reasoning.defaultEffort`).
 * The footer is the terminal's only place that can answer "what level is this",
 * so it follows the same rule instead of inventing a second one.
 *
 * The catalog's `default` selection is the Host's default for *new* Sessions,
 * and `session/selectModel` saves every choice there. `defaultThinkingLevelOf`
 * therefore answers "what would a new Session start at" for this route, which
 * is the badge the `/thinking` picker draws.
 *
 * A model without a `reasoning` block has no level at all, and no catalog yet
 * means only an explicit choice can be named.
 *
 * @module hulala-cli/tui/data/thinkingLevel
 */
import type {
  TerminalModel,
  TerminalModelCatalog,
  TerminalThinkingLevel,
} from './remote.js'

/** The catalog entry for one route, when the catalog knows it. */
function entryOf(model: TerminalModel, catalog: TerminalModelCatalog) {
  return catalog.groups
    .find(group => group.id === model.provider)?.models
    .find(candidate => candidate.id === model.model)
}

/**
 * Resolve the thinking level a route runs at.
 * @param model - the Session's selection, explicit effort included.
 * @param catalog - the Host catalog, when the client has read it.
 * @returns the effort id in effect (`off`, `low`, `high`, `max`, …), or
 *   undefined when the model does not reason.
 */
export function thinkingLevelOf(
  model: TerminalModel | undefined,
  catalog: TerminalModelCatalog | undefined,
): string | undefined {
  if (model === undefined) return undefined
  if (model.reasoningEffort !== undefined) return model.reasoningEffort
  if (catalog === undefined) return undefined
  return entryOf(model, catalog)?.reasoning?.defaultEffort
}

/**
 * The levels this route advertises, in the adapter's order.
 * @param model - the route to describe.
 * @param catalog - the Host catalog; none means no levels are known yet.
 * @returns the efforts the picker may offer; empty for a model that does not reason.
 */
export function thinkingLevelsOf(
  model: TerminalModel | undefined,
  catalog: TerminalModelCatalog | undefined,
): readonly TerminalThinkingLevel[] {
  if (model === undefined || catalog === undefined) return []
  return entryOf(model, catalog)?.reasoning?.efforts ?? []
}

/**
 * The level a new Session would start at on this route.
 *
 * The Host's default selection is the whole selection, not just an effort, so
 * this only answers for the same route: a default pointed at another model says
 * nothing about these levels.
 * @param model - the route the picker is showing.
 * @param catalog - the Host catalog carrying the live default selection.
 * @returns the effort id new Sessions start at, or undefined when the default
 *   is another route or the model does not reason.
 */
export function defaultThinkingLevelOf(
  model: TerminalModel | undefined,
  catalog: TerminalModelCatalog | undefined,
): string | undefined {
  if (model === undefined || catalog === undefined) return undefined
  if (catalog.default.provider !== model.provider || catalog.default.model !== model.model) return undefined
  return catalog.default.reasoningEffort ?? entryOf(model, catalog)?.reasoning?.defaultEffort
}
