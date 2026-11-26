/**
 * The passive views: the conversation, the welcome block's loaded facts, the
 * pending-inbox rows, the directory line, and the status row.
 *
 * "Passive" is the point. Each one is a projection of state somebody else owns —
 * the reducer's fold, the Session's facts, the updater's hint, the Host's
 * startup answer — so none of them holds a fact of its own. They register into
 * their seats and are refreshed by the frame, which is what removed the seven
 * "remember to copy `reducer.items` in" call sites the client used to carry.
 *
 * Reasoning expansion lives here too: it is display state over the transcript's
 * own items, not Session state.
 *
 * @module hulala-cli/tui/plugins/view
 */
import type { Context } from '@deepseek-ai/cordis'
import { CwdBar } from '../view/cwdBar.js'
import { Fade } from '../view/fade.js'
import { HINT_INTERVAL_MS } from '../view/hints.js'
import { PendingMessages } from '../view/pendingMessages.js'
import { Welcome } from '../view/welcome.js'
import { StatusBar } from '../view/statusBar.js'
import { createToolImagery } from '../view/toolImages.js'
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
  /**
   * The welcome block the conversation opens with.
   *
   * The transcript owns where it is drawn; who fills its loaded facts is the
   * startup plugin's business, so the two never have to agree about when a
   * Session opens.
   */
  readonly welcome: Welcome
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

  // Built here because the transcript draws it; its facts are filled by the
  // startup plugin, because the Host is what knows them.
  const welcome = new Welcome(config.color)
  // A result's picture is stored on the Host, not in the Session log: the rows
  // read it back through this Session's own attachment route, once per image,
  // and ask for the frame that draws it when the bytes land.
  const imagery = createToolImagery({
    read: async (image) => {
      const sessionId = session.id
      if (ctx.backend.readImage === undefined || sessionId === undefined) {
        throw new Error('this Host offers no attachment read')
      }
      return await ctx.backend.readImage(sessionId, image)
    },
    onChange: () => { render.request() },
    color: config.color,
  })
  // A picture belongs to the Session on screen. The switch rebuilds the
  // transcript, so the rows that drew the last Session's images are gone; the
  // bytes go with them instead of accumulating one Session at a time. A reopen
  // of the same Session (a reconnect) keeps it.
  let pictured = session.id
  ctx.on('hulala/session-opened', (id) => {
    if (id === pictured) return
    pictured = id
    imagery.clear()
  })
  const transcript = new Transcript(config.color, () => ({ cwd: session.cwd, home }), welcome, imagery)
  // The working-directory line steps aside while the completion menu is up.
  const cwdBar = new CwdBar(() => ({ cwd: session.cwd, hidden: editor.completionMenuOpen }), config.color)
  // Pending inbox rows sit between the transcript and the composer, where pi
  // puts its queued-message block; empty lists render no lines at all.
  const pending = new PendingMessages(config.color)
  const statusBar = new StatusBar(() => {
    const waiting = ctx.get('hulalaInteractions')?.waiting ?? 0
    const parked = ctx.get('hulalaInteractions')?.parked ?? 0
    return {
      ...(session.model === undefined ? {} : { model: session.model }),
      ...(session.thinkingLevel === undefined ? {} : { thinkingLevel: session.thinkingLevel }),
      ...(session.permission === undefined ? {} : { permission: session.permission }),
      metrics: reducer.metrics,
      disconnected: session.disconnected,
      ...(waiting > 0 ? { pendingInteractions: waiting } : {}),
      ...(parked > 0 ? { parkedInteractions: parked } : {}),
      ...(updater.available === undefined ? {} : { update: updater.available.latestVersion }),
    }
  }, config.color)

  // The band's usage hint rotates on its own; while the client is idle this is
  // the only reason the frame repaints.
  ctx.effect(() => {
    const timer = setInterval(() => { render.request() }, HINT_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, 'hulala: status hints')

  // The transcript sits inside a viewport the frame reuses across rebuilds, so
  // it carries its own fade instead of receiving one from the layout tree: a
  // ScrollView keeps the content component it was built with, and a wrapped
  // content created per rebuild would only ever apply to the first layout. A
  // dialog is the current surface while it is up, so the transcript fades behind
  // it even though the keyboard was the composer's.
  const transcriptPanel = new Fade(
    transcript,
    () => {
      const focus = ctx.get('hulalaFocus')
      return focus?.modal === true || (focus?.panel ?? 'composer') !== 'composer'
    },
    config.color,
  )
  layout.register('main', { id: 'transcript', component: transcriptPanel })
  layout.register('dock.pending', { id: 'pending', component: pending })
  layout.register('dock.cwd', { id: 'cwd', component: cwdBar })
  // The band under the columns is a panel too, and it has no other inactive
  // state: it goes faint while a dialog is up, so the dialog is the only lit
  // surface in the frame.
  const statusPanel = new Fade(statusBar, () => ctx.get('hulalaFocus')?.modal === true, config.color)
  layout.register('dock.status', { id: 'status', component: statusPanel })

  // The conversation is a projection of the fold, and the inbox rows a
  // projection of its pending lists: both are flushed by the frame instead of
  // by every caller that folds an event.
  render.onSync(() => { transcript.setItems(reducer.items) })
  render.onSync(() => { transcript.setRunning(reducer.busy ? reducer.turnStartedAt : undefined) })
  render.onSync(() => { pending.setState(reducer.pending) })

  ctx.provide('hulalaView', {
    transcript,
    welcome,
    cycleReasoning: () => transcript.cycleReasoning(),
    toggleExpandAll: () => { transcript.toggleExpandAll() },
  })
}

/** Cordis object-form plugin. */
export const viewPlugin = {
  name: 'hulala-view',
  inject: ['backend', 'hulalaRender', 'hulalaLayout', 'hulalaSession', 'hulalaUpdate', 'hulalaViewModel', 'hulalaComposer'],
  apply,
}
