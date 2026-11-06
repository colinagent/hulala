/**
 * The four passive views: the conversation, the pending-inbox rows, the
 * directory line, and the status row.
 *
 * "Passive" is the point. Each one is a projection of state somebody else owns —
 * the reducer's fold, the Session's facts, the updater's hint — so none of them
 * holds a fact of its own. They register into their seats and are refreshed by
 * the frame, which is what removed the seven "remember to copy `reducer.items`
 * in" call sites the client used to carry.
 *
 * Reasoning expansion lives here too: it is display state over the transcript's
 * own items, not Session state.
 *
 * @module hulala-cli/tui/plugins/view
 */
import type { Context } from '@deepseek-ai/cordis'
import { CwdBar } from '../view/cwdBar.js'
import { HINT_INTERVAL_MS } from '../view/hints.js'
import { PendingMessages } from '../view/pendingMessages.js'
import { StatusBar } from '../view/statusBar.js'
import { Transcript } from '../view/transcript.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The conversation and the dock rows above and below the composer. */
    hulalaView: TuiView
  }
}

/** What the client reads and toggles on the passive views. */
export interface TuiView {
  readonly transcript: Transcript
  /** `Ctrl-R`: cycle how much reasoning the transcript shows. */
  cycleReasoning(): string
  /** `Ctrl-O`: expand or collapse every tool card. */
  toggleExpandAll(): void
}

/** Colour flag for the terminal this client attached to. */
export interface ViewPluginConfig {
  readonly color: boolean
}

/** Build the views and claim their seats. */
export function apply(ctx: Context, config: ViewPluginConfig): void {
  const render = ctx.hulalaRender
  const layout = ctx.hulalaLayout
  const session = ctx.hulalaSession
  const updater = ctx.hulalaUpdate
  const { reducer } = ctx.hulalaViewModel
  const { editor } = ctx.hulalaComposer
  const home = process.env.HOME ?? process.env.USERPROFILE

  const transcript = new Transcript(config.color, () => ({ cwd: session.cwd, home }))
  // The working-directory line steps aside while the completion menu is up.
  const cwdBar = new CwdBar(() => ({ cwd: session.cwd, hidden: editor.completionMenuOpen }), config.color)
  // Pending inbox rows sit between the transcript and the composer, where pi
  // puts its queued-message block; empty lists render no lines at all.
  const pending = new PendingMessages(config.color)
  const statusBar = new StatusBar(() => ({
    ...(session.model === undefined ? {} : { model: session.model }),
    ...(session.thinkingLevel === undefined ? {} : { thinkingLevel: session.thinkingLevel }),
    metrics: reducer.metrics,
    disconnected: session.disconnected,
    ...(updater.available === undefined ? {} : { update: updater.available.latestVersion }),
  }), config.color)

  // The band's usage hint rotates on its own; while the client is idle this is
  // the only reason the frame repaints.
  ctx.effect(() => {
    const timer = setInterval(() => { render.request() }, HINT_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, 'hulala: status hints')

  layout.register('main', { id: 'transcript', component: transcript })
  layout.register('dock.pending', { id: 'pending', component: pending })
  layout.register('dock.cwd', { id: 'cwd', component: cwdBar })
  layout.register('dock.status', { id: 'status', component: statusBar })

  // The conversation is a projection of the fold, and the inbox rows a
  // projection of its pending lists: both are flushed by the frame instead of
  // by every caller that folds an event.
  render.onSync(() => { transcript.setItems(reducer.items) })
  render.onSync(() => { transcript.setRunning(reducer.busy ? reducer.turnStartedAt : undefined) })
  render.onSync(() => { pending.setState(reducer.pending) })

  ctx.provide('hulalaView', {
    transcript,
    cycleReasoning: () => transcript.cycleReasoning(),
    toggleExpandAll: () => { transcript.toggleExpandAll() },
  })
}

/** Cordis object-form plugin. */
export const viewPlugin = {
  name: 'hulala-view',
  inject: ['hulalaRender', 'hulalaLayout', 'hulalaSession', 'hulalaUpdate', 'hulalaViewModel', 'hulalaComposer'],
  apply,
}
