/**
 * The composer: the one line the user types into, and the dock slot that lets a
 * picker take its place.
 *
 * Two things live here because they are the same surface. The `PromptEditor`
 * owns the draft, history and submit gestures; the `ComposerSlot` swaps the
 * whole input block for a selector without the dock ever losing its row — which
 * is why a picker is not an overlay: it keeps the layout stable and returns the
 * composer in the same tick it closes.
 *
 * The theme is here too. Both the composer and the transcript read it, but the
 * editor's colour set is what the composer is built from, so it is resolved once
 * with the composer rather than passed around.
 *
 * @module hulala-cli/tui/plugins/composer
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Component } from '@earendil-works/pi-tui'
import { buildTheme, faintCursorSgr, type ThemeSet } from '../view/theme.js'
import { PromptEditor } from '../view/promptEditor.js'
import { ComposerSlot } from '../view/composerSlot.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The input line, its theme, and the dock slot a picker can borrow. */
    hulalaComposer: TuiComposer
  }
}

/** What the rest of the client may do with the composer. */
export interface TuiComposer {
  /** The component that occupies `dock.input`. */
  readonly slot: ComposerSlot
  /** The editor inside it; focus target and draft owner. */
  readonly editor: PromptEditor
  /** Resolved colour set, shared with the transcript. */
  readonly theme: ThemeSet
  /**
   * Run one selector in the composer's place.
   *
   * The panel takes focus and keeps the app's global keys (interrupt, double
   * `Esc`, pane chords) out of the way until it resolves; the composer comes
   * back in the same tick, so the dock never loses its slot.
   * @param build - receives the resolver the selector calls when it is done.
   * @returns the selector's result.
   */
  panel<T>(build: (done: (value: T) => void) => Component): Promise<T>
}

/** Colour flag for the terminal this client attached to. */
export interface ComposerPluginConfig {
  readonly color: boolean
}

/** Build the composer and claim `dock.input`. */
export function apply(ctx: Context, config: ComposerPluginConfig): void {
  const { screen, focus: focusOn, setPaging, setMenuPaging } = ctx.hulalaTerminal
  const render = ctx.hulalaRender
  const layout = ctx.hulalaLayout
  const nvim = ctx.hulalaEditor
  const overlays = ctx.hulalaOverlays

  const theme = buildTheme(config.color)
  const editor = new PromptEditor(screen, theme.editor, {
    color: config.color,
    faintCursor: () => faintCursorSgr(config.color, nvim.theme.background, nvim.theme.foreground),
    // While the completion menu is up, PageUp/PageDown page its five-row window
    // instead of the transcript — pi's `capturesViewportInput`, arbitrated here
    // because the alt-screen viewport claims those keys before the editor.
    onMenuOpen: open => setMenuPaging(open),
  })
  // `/model` and `/login` take the composer's place in the dock, as pi's
  // pickers do; the layout always holds this slot instead of the editor.
  const slot = new ComposerSlot(editor)

  layout.register('dock.input', { id: 'composer', component: slot })

  const panel = <T>(build: (done: (value: T) => void) => Component): Promise<T> => {
    return new Promise<T>(resolve => {
      let settled = false
      const finish = (value: T): void => {
        if (settled) return
        settled = true
        release()
        slot.restore()
        setPaging(true)
        focusOn(editor)
        render.request(true)
        resolve(value)
      }
      const built = build(finish)
      const release = overlays.hold()
      slot.show(built)
      // The selector pages its own list, so the transcript must not claim
      // PageUp/PageDown while it is up.
      setPaging(false)
      focusOn(built)
      render.request(true)
    })
  }

  ctx.provide('hulalaComposer', { slot, editor, theme, panel })
}

/** Cordis object-form plugin. */
export const composerPlugin = {
  name: 'hulala-composer',
  inject: ['hulalaTerminal', 'hulalaRender', 'hulalaLayout', 'hulalaEditor', 'hulalaOverlays'],
  apply,
}
