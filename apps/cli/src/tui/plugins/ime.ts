/**
 * The keyboard's input source as a capability.
 *
 * A surface that reads keys as commands — Neovim in normal mode, the rail with
 * its `j`/`k`/`n`, a selector, a confirmation — types in English, or a Chinese
 * input method eats the key into a composition and the action does not happen.
 * A surface that reads keys as text — the composer, a question's free-text
 * answer, Neovim in insert mode — is left on the user's own source, and gets it
 * back when the client is the one that moved it.
 *
 * Who is which is declared by the surface itself (`imePolicy`, see
 * `../pane/focus.ts`) and delivered through the terminal's focus funnel, so this
 * plugin listens rather than asking. The rule for when to switch, what to
 * remember and what to give back lives in `../editor/inputSource.ts`.
 *
 * @module hulala-cli/tui/plugins/ime
 */
import type { Context } from '@deepseek-ai/cordis'
import { inputSource, inputSourceOwnership, type InputSourceOwnership } from '../editor/inputSource.js'
import { t } from '../i18n/index.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The macOS input source the client keeps, and gives back. */
    hulalaIme: InputSourceOwnership
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

/** Provide the input-source ownership for this window. */
export function apply(ctx: Context, config: ImePluginConfig): void {
  const editor = ctx.hulalaEditor
  const terminal = ctx.hulalaTerminal
  const reducer = ctx.hulalaViewModel.reducer
  const render = ctx.hulalaRender
  const ownership = inputSourceOwnership(
    () => config.live ? inputSource(editor.ime) : undefined,
    {
      // A machine with no English layout cannot be switched, and that looks
      // exactly like a broken switch: say it once, then leave the user alone.
      onUnavailable: () => {
        reducer.addNotice(t('ime.noEnglishSource'))
        render.repaint()
      },
    },
  )
  ctx.provide('hulalaIme', ownership)
  terminal.observeIme(policy => {
    if (policy === 'command') ownership.acquire()
    else ownership.release()
  })
  // Quitting while a column has the keyboard must not leave the machine in
  // English: the user's shell prompt is theirs too.
  ctx.effect(() => () => ownership.restoreNow(), 'hulala: input source restored')
}

/** Cordis object-form plugin. */
export const imePlugin = {
  name: 'hulala-ime',
  inject: ['hulalaEditor', 'hulalaTerminal', 'hulalaViewModel', 'hulalaRender'],
  apply,
}
