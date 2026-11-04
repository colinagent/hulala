/**
 * The Session view model: Host events folded into transcript items, busy state,
 * token metrics and the pending inbox.
 *
 * It is a plugin rather than a local because two clients share it — the
 * interactive one and the non-TTY fallback in `app.ts` — and because folding is
 * pure: `ViewModelReducer` never touches the terminal, so its state can outlive
 * any particular view.
 *
 * @module hulala-cli/tui/plugins/viewModel
 */
import type { Context } from '@deepseek-ai/cordis'
import { ViewModelReducer } from '../data/viewModel.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Fold state for the attached Session. */
    hulalaViewModel: TuiViewModel
  }
}

/** The view model a view reads and the client drives. */
export interface TuiViewModel {
  readonly reducer: ViewModelReducer
}

/** Provide one reducer per window. */
export function apply(ctx: Context): void {
  ctx.provide('hulalaViewModel', { reducer: new ViewModelReducer() })
}

/** Cordis object-form plugin. */
export const viewModelPlugin = { name: 'hulala-view-model', apply }
