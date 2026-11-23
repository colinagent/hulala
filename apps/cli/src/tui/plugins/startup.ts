/**
 * The welcome block's facts: what this Session loaded besides its tools.
 *
 * The block itself is a view (`view/welcome.ts`); this plugin is the only place
 * that asks the Host what belongs in it. Two facts, two sources, one rule: an
 * answer that does not arrive leaves the block empty rather than delaying the
 * window or inventing a heading. A launch reminder — the update notice, the
 * changelog — is a transcript row and therefore prints below whatever this
 * loaded, which is the order a reader expects: banner first, then what is in
 * effect, then what changed.
 *
 * The facts belong to a Session, and a Session can be switched or moved to
 * another directory (`/resume`, `/new`, a `cwd` move). Both change the answer,
 * so the key is the pair — not the id alone. The Host also re-emits a Session
 * change for every list event, and re-reading the Host's documents on each of
 * those would be one round trip per turn; only a different pair reloads.
 *
 * @module hulala-cli/tui/plugins/startup
 */
import type { Context } from '@deepseek-ai/cordis'

/** Ask the Host for the open Session's facts, and keep the block in step. */
export function apply(ctx: Context): void {
  const view = ctx.hulalaView
  const session = ctx.hulalaSession
  const backend = ctx.backend
  const render = ctx.hulalaRender
  /** The Session pair the block currently describes. */
  let described: string | undefined
  /** Dropped out-of-order answers: only the newest request may fill the block. */
  let generation = 0

  const load = (): void => {
    const id = session.id
    const key = id === undefined ? undefined : `${id}\0${session.cwd}`
    if (key === described) return
    described = key
    const current = ++generation
    // Not loaded (no Session yet, or a backend without the route) is a rendering
    // of its own: the block disappears instead of showing the previous
    // Session's skills under this one's banner.
    if (id === undefined || backend.startupFacts === undefined) {
      view.welcome.setFacts(undefined)
      render.request()
      return
    }
    void backend.startupFacts(id)
      .then((facts) => {
        // A Session switched again while this answered: the newer read owns the
        // block, and the row must not flip back to an older Session's list.
        if (current !== generation) return
        view.welcome.setFacts(facts)
        render.request()
      })
      .catch(() => {
        if (current !== generation) return
        view.welcome.setFacts(undefined)
        render.request()
      })
  }

  // `session-opened` is the switch — opening, resuming or replacing a Session —
  // and it fires with the new id already in place. `session-changed` covers the
  // rest of the same pair: a list event that moves the directory under the open
  // Session must re-read too, and the key guard above is what keeps the per-turn
  // list events from turning into per-turn round trips.
  ctx.on('hulala/session-opened', load)
  ctx.on('hulala/session-changed', load)
  // The first Session may have opened before this plugin was mounted: one read
  // at startup covers it, and the events cover every switch afterwards.
  load()
}

/** Cordis object-form plugin. */
export const startupPlugin = {
  name: 'hulala-startup',
  inject: ['backend', 'hulalaView', 'hulalaSession', 'hulalaRender'],
  apply,
}
