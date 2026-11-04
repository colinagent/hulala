/**
 * The terminal client's plugin host.
 *
 * One terminal window is one Cordis `Context`. It is the same shape as the
 * Host's context and the Web page's context — a container that plugins are
 * assembled into — but it is a **different process**, so it shares nothing with
 * the Host except the authenticated transport in `data/remote.ts`.
 *
 * The kernel owns two things no plugin can own:
 *
 * - the `Context` itself (the mechanism that loads plugins cannot arrive
 *   through a plugin);
 * - disposal. `dispose()` tears down the whole tree, which is what makes
 *   closing a window stop its ptys, timers and subscriptions without anyone
 *   remembering to call a cleanup function.
 *
 * Everything else — transport, session, view model, layout, panes, overlays —
 * is a plugin on this context.
 *
 * @module hulala-cli/tui/kernel
 */
import { Context } from '@deepseek-ai/cordis'
import type { TerminalBackend } from './data/remote.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The attached Host's transport, as the terminal client consumes it. */
    backend: TerminalBackend
  }
}

/** One terminal window's plugin host. */
export interface TerminalKernel {
  readonly ctx: Context
  /** Tear down every plugin, in reverse order, and settle their effects. */
  dispose(): Promise<void>
}

/**
 * Create a bare kernel: a context with no plugins yet.
 *
 * The caller registers the transport and then hands `ctx` to
 * {@link runTerminalClient}, which provides the backend and loads the UI
 * plugins.
 * @returns the kernel and its idempotent disposer.
 */
export function createTerminalKernel(): TerminalKernel {
  const ctx = new Context()
  let disposed = false
  return {
    ctx,
    // Idempotent on purpose: the client disposes before `process.exit()` so the
    // screen, ptys and streams come down in order, and the caller's `finally`
    // disposes again on every path that does not exit.
    dispose: async () => {
      if (disposed) return
      disposed = true
      await ctx.fiber.dispose()
    },
  }
}

/**
 * Publish the backend as a service so plugins can declare it in `inject`.
 *
 * The client provides the backend rather than the transport plugin doing it, so
 * the interactive path and the test path (a fake backend, no Host) publish the
 * identical service.
 * @param ctx - the kernel's context.
 * @param backend - the attached transport, real or fake.
 */
export function provideBackend(ctx: Context, backend: TerminalBackend): void {
  ctx.provide('backend', backend)
}
