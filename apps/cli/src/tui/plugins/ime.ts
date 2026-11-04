/**
 * The keyboard's input source as a capability.
 *
 * A panel that reads keys as program input — the Session rail with its filter
 * box, Neovim, the shell column — types in English, so each asks for it when it
 * takes the keyboard. The composer is never touched: it is where the user
 * composes, and a source chosen there by hand must survive the round trip through
 * the sidebar.
 *
 * Owning the rule here rather than in each panel keeps the one selection target
 * in one place.
 *
 * @module hulala-cli/tui/plugins/ime
 */
import type { Context } from '@deepseek-ai/cordis'
import { inputSource, inputSourceSwitch, type InputSourceSwitch } from '../editor/inputSource.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The macOS input source the client keeps. */
    hulalaIme: InputSourceSwitch
  }
}

/** Whether this window owns a real terminal, or a test injected its streams. */
export interface ImePluginConfig {
  /**
   * Touching the input source is a machine-wide side effect, so a window fed by
   * injected streams leaves it alone: a test suite that opens a column must not
   * change the developer's keyboard layout.
   */
  readonly live: boolean
}

/** Provide the input-source switch for this window. */
export function apply(ctx: Context, config: ImePluginConfig): void {
  const editor = ctx.hulalaEditor
  const source = inputSourceSwitch(() => config.live ? inputSource(editor.ime) : undefined)
  ctx.provide('hulalaIme', source)
}

/** Cordis object-form plugin. */
export const imePlugin = { name: 'hulala-ime', inject: ['hulalaEditor'], apply }
