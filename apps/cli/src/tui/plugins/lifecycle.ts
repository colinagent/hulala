/**
 * Whether the window is going away.
 *
 * One flag, one writer: `close()`. Everything that must stop taking new work
 * reads it — a focus gesture, a command, a reconnect, a key handler — so the
 * question "am I still live?" has exactly one answer and cannot drift between
 * closures.
 *
 * It is a plugin rather than a local because the readers are plugins too: a rail
 * that grabs focus while the client is shutting down would paint a column that
 * is about to be torn off the screen.
 *
 * @module hulala-cli/tui/plugins/lifecycle
 */
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The window's closing flag. */
    hulalaLifecycle: TuiLifecycle
  }
}

/** What the client asks about its own lifetime. */
export interface TuiLifecycle {
  /** The window is closing; no new work may start. */
  readonly closing: boolean
  /**
   * Take ownership of the close.
   * @returns false when something already started closing the window.
   */
  beginClose(): boolean
}

/** Provide the flag. */
export function apply(ctx: Context): void {
  let closing = false
  ctx.provide('hulalaLifecycle', {
    get closing() { return closing },
    beginClose: () => {
      if (closing) return false
      closing = true
      return true
    },
  })
}

/** Cordis object-form plugin. */
export const lifecyclePlugin = { name: 'hulala-lifecycle', apply }
