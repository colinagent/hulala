/**
 * The editor's colours and its macOS input-source helper.
 *
 * The editor itself is a Host program now: Neovim, its runtime, the vendored
 * plugins and the generated settings live in the state root on the machine that
 * runs it, and `@hulala/editor-home` owns that layout. What the client still
 * needs is the theme Neovim should paint and the helper that switches the input
 * source when the column changes mode — both are facts about this terminal.
 *
 * @module hulala-cli/tui/plugins/editor
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FALLBACK_THEME, editorEnvironment, editorPackageRoot, publishEditor, resolveEditorHome, type EditorTheme } from '@hulala/editor-home'
import { resolvePaths } from '../../paths.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The editor's theme and input-source helper. */
    hulalaEditor: TuiEditor
  }
}

/** What the column host asks the editor capability for. */
export interface TuiEditor {
  /** The theme the Host should paint Neovim with. */
  readonly theme: EditorTheme
  /** macOS input-source helper: published in `bin/`, or built from the checkout. */
  readonly ime: string | undefined
  /** Update the theme from the terminal's current colours. */
  setTheme(theme: EditorTheme): void
}

/** Provide the editor capability for this state root. */
export function apply(ctx: Context): void {
  const dataRoot = resolvePaths().data
  const home = resolveEditorHome(dataRoot)
  let theme: EditorTheme = FALLBACK_THEME

  ctx.provide('hulalaEditor', {
    get theme() { return theme },
    get ime() { return home.ime },
    setTheme: (next: EditorTheme) => {
      theme = next
    },
  })
}

/** Cordis object-form plugin. */
export const editorPlugin = { name: 'hulala-editor', apply }
