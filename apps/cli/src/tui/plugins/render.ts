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
 * @module hulala-cli/tui/plugins/render
 */
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The frame loop's sync steps and repaint request. */
    hulalaRender: TuiRender
  }
}

/** The surface a plugin uses instead of touching the screen. */
export interface TuiRender {
  /** Ask for a frame; pi-tui coalesces it with any other request this tick. */
  request(force?: boolean): void
  /** Run every sync step, then ask for a frame. */
  repaint(): void
  /**
   * Register a step that must run before a repaint.
   * @param step - re-syncs one feature's view state.
   * @returns idempotent unregister.
   */
  onSync(step: () => void): () => void
}

/** Provide the loop; it owns no state of its own beyond the step list. */
export function apply(ctx: Context): void {
  const { screen } = ctx.hulalaTerminal
  const steps = new Set<() => void>()
  ctx.effect(() => () => steps.clear(), 'hulala: render steps')
  ctx.provide('hulalaRender', {
    request: (force?: boolean) => { screen.requestRender(force) },
    repaint: () => {
      for (const step of steps) step()
      screen.requestRender()
    },
    onSync: (step: () => void) => {
      steps.add(step)
      return () => { steps.delete(step) }
    },
  })
}

/** Cordis object-form plugin. */
export const renderPlugin = { name: 'hulala-render', inject: ['hulalaTerminal'], apply }
