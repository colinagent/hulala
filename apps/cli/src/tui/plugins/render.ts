/**
 * The repaint loop, as a service.
 *
 * `rerender()` in the client is "re-sync whatever changed, then ask pi-tui for a
 * frame". Both halves belong to more than one feature — the rail's timer, the
 * turn clock and the pending inbox each have to be re-synced before any repaint
 * that could show them — so the ordering has to live in one place instead of
 * being re-derived by every caller.
 *
 * A plugin registers its sync step once (`onSync`) and then only asks for a
 * frame. That is the difference between "the rail repaints the clock" and "the
 * rail says something changed".
 *
 * Two verbs, and the difference between them is the whole point:
 *
 * - `request()` asks for the next frame. pi-tui writes only the rows whose text
 *   differs from its own copy of the screen, so this is correct exactly as long
 *   as that copy still describes the terminal.
 * - `reconcile(reason)` says that copy may be wrong, so the next frame is every
 *   row, preceded by a full clear. Anything that can change the terminal without
 *   going through a frame belongs here: a discarded frame, a resize, a reconnect,
 *   a rebuilt frame tree, the user's own `Ctrl-L`.
 *
 * The reason is not decoration: it is the only durable record of why a window
 * painted everything, and the debug trace prints it. There is no third verb and
 * no "force" flag — {@link TuiRender.request} cannot ask for a full repaint,
 * which is what keeps the decision from spreading again.
 *
 * @module hulala-cli/tui/plugins/render
 */
import type { Context } from '@deepseek-ai/cordis'
import type { LostReason } from '../terminal/writer.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The frame loop's sync steps and repaint request. */
    hulalaRender: TuiRender
  }
}

/**
 * Why the next frame is every row.
 *
 * The first group means the renderer's copy of the screen cannot be trusted; the
 * second means every row is going to differ anyway, so a full paint costs nothing
 * and removes the chance of a skipped cell.
 */
export type ReconcileReason =
  /** The output queue discarded a frame (see {@link LostReason}). */
  | LostReason
  /** The terminal was disconnected; it may have reflowed or been written over. */
  | 'reconnect'
  /** The machine slept; a suspended pty may have lost or spilled bytes. */
  | 'wake'
  /** The frame tree was rebuilt: columns, widths and the dock's height moved. */
  | 'layout'
  /** `Ctrl-L`: the user asking for a clean screen. */
  | 'manual'
  /** Every visible string changed language. */
  | 'language'
  /** Every hint and every binding label changed. */
  | 'keymap'
  /** A composer slot panel opened or closed, so the dock changed height. */
  | 'slot'
  /** A modal was pushed or popped, covering or uncovering the rows beneath it. */
  | 'overlay'

/** The surface a plugin uses instead of touching the screen. */
export interface TuiRender {
  /** Ask for a frame; pi-tui coalesces it with any other request this tick. */
  request(): void
  /** Run every sync step, then ask for a frame. */
  repaint(): void
  /**
   * Throw the renderer's copy of the screen away; the next frame is every row.
   * @param reason - why the copy cannot be trusted, for the debug trace.
   */
  reconcile(reason: ReconcileReason): void
  /**
   * Register a step that must run before a repaint.
   * @param step - re-syncs one feature's view state.
   * @returns idempotent unregister.
   */
  onSync(step: () => void): () => void
}

/** The debug sink, absent unless `HULALA_DEBUG_CLIENT` is set. */
export interface RenderPluginConfig {
  readonly debug?: (message: string) => void
}

/** Provide the loop; it owns no state of its own beyond the step list and a counter. */
export function apply(ctx: Context, config: RenderPluginConfig = {}): void {
  const { screen } = ctx.hulalaTerminal
  const steps = new Set<() => void>()
  /** How many times the whole screen has been repainted, for the trace. */
  let reconciles = 0
  const sync = (): void => {
    for (const step of steps) step()
  }
  ctx.effect(() => () => steps.clear(), 'hulala: render steps')
  ctx.provide('hulalaRender', {
    request: () => { screen.requestRender() },
    repaint: () => {
      sync()
      screen.requestRender()
    },
    reconcile: (reason: ReconcileReason) => {
      reconciles += 1
      config.debug?.(`reconcile ${reason} #${String(reconciles)}`)
      // The whole mechanism is pi-tui's own reset: it drops the screen it thinks
      // it is showing, so the next frame is a clear plus every row.
      sync()
      screen.requestRender(true)
    },
    onSync: (step: () => void) => {
      steps.add(step)
      return () => { steps.delete(step) }
    },
  })
}

/** Cordis object-form plugin. */
export const renderPlugin = {
  name: 'hulala-render',
  inject: ['hulalaTerminal'],
  apply,
}
