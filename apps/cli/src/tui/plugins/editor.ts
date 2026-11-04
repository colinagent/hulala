/**
 * The bundled editor as a capability: where it lives, how it starts, and the
 * three files it reports back through.
 *
 * The editor is not a dependency of the terminal client — it ships with it, one
 * Neovim build per release platform plus the vendored plugins, published into
 * the state root on first use so a user never needs their own Neovim or config.
 * This plugin owns all of that: the state-root layout, the environment each
 * process is given, and the markers that report the facts a terminal cannot
 * observe directly (current mode, a buffer/disk conflict, a committed quit).
 *
 * It deliberately owns no column and no layout. Whether the editor is on screen
 * is the workspace's decision; this plugin only answers "can it run, and how".
 *
 * @module hulala-cli/tui/plugins/editor
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  editorEnvironment,
  editorPackageRoot,
  ensureEditorConfig,
  publishEditor,
  resolveEditorHome,
  type EditorHome,
} from '../editor/editorHome.js'
import { FALLBACK_THEME, type EditorTheme } from '../editor/editorTheme.js'
import { ripgrepPathEntry } from '../../ripgrep.js'
import { resolvePaths } from '../../paths.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The bundled editor's files, environment and reported state. */
    hulalaEditor: TuiEditor
  }
}

/** One reported file conflict: the path Neovim refused to write. */
export interface EditorConflict {
  readonly path: string
}

/** What the column host asks the editor capability for. */
export interface TuiEditor {
  /** The executable to start: the published binary, else `nvim` from `PATH`. */
  readonly command: string
  /** macOS input-source helper, when the package ships one. */
  readonly ime: string | undefined
  /** Theme resolved from the terminal palette. */
  readonly theme: EditorTheme
  /**
   * Publish the bundled editor and write its config, once per package.
   *
   * Safe to call before every start; the publish is digest-guarded, so an
   * unchanged package copies nothing.
   * @throws when the package cannot be published — the caller turns that into a
   *   notice rather than a dead column.
   */
  prepare(): void
  /** Environment for one editor process: isolated XDG homes, theme, plugins. */
  environment(): Record<string, string>
  /** Update the theme from the terminal's current colours. */
  setTheme(theme: EditorTheme): void
  /** Neovim's mode from its last `ModeChanged`, or undefined before one. */
  mode(): string | undefined
  /** Forget the mode, so a fresh process does not inherit the last one's. */
  resetMode(): void
  /** Delete all three per-process markers. */
  clearMarkers(): void
  /**
   * Read and clear one reported conflict.
   * @returns the path, or undefined when nothing was reported.
   */
  takeConflict(): string | undefined
  /** Whether Neovim committed a quit (`VimLeavePre` fired). */
  leaveCommitted(): boolean
  /** Forget a previous quit marker before asking again. */
  resetLeave(): void
}

/** Provide the editor capability for this state root. */
export function apply(ctx: Context): void {
  const dataRoot = resolvePaths().data
  const cache = join(dataRoot, 'cache', 'editor')
  /**
   * Per process, not per state root: two clients on one machine can drive the
   * same editor home at once, and their mode/conflict reports must not mix.
   */
  const modeFile = join(cache, `mode-${process.pid}.txt`)
  const conflictFile = join(cache, `conflict-${process.pid}.txt`)
  const leaveFile = join(cache, `leave-${process.pid}.txt`)

  let home: EditorHome = resolveEditorHome(dataRoot)
  let published = false
  let theme: EditorTheme = FALLBACK_THEME

  const clearMarkers = (): void => {
    rmSync(modeFile, { force: true })
    rmSync(conflictFile, { force: true })
    rmSync(leaveFile, { force: true })
  }

  ctx.effect(() => clearMarkers, 'hulala: editor markers')

  ctx.provide('hulalaEditor', {
    get command() { return home.command },
    get ime() { return home.ime },
    get theme() { return theme },
    setTheme: (next: EditorTheme) => {
      theme = next
    },
    prepare: () => {
      if (!published) {
        publishEditor(home)
        // The binary and its data now exist, so re-resolve: `command` switches
        // from `nvim` on `PATH` to `<data>/bin/nvim`.
        home = resolveEditorHome(dataRoot)
        published = true
      }
      ensureEditorConfig(home)
    },
    environment: () => ({
      ...editorEnvironment(home, theme, ripgrepPathEntry(dataRoot, { packageRoot: editorPackageRoot() })),
      HULALA_NVIM_MODE_FILE: modeFile,
      HULALA_NVIM_CONFLICT_FILE: conflictFile,
      HULALA_NVIM_LEAVE_FILE: leaveFile,
    }),
    mode: () => {
      try {
        return readFileSync(modeFile, 'utf8').trim()
      } catch {
        return undefined
      }
    },
    resetMode: () => {
      rmSync(modeFile, { force: true })
    },
    clearMarkers,
    takeConflict: () => {
      let line = ''
      try {
        line = readFileSync(conflictFile, 'utf8').split('\n', 1)[0]?.trim() ?? ''
      } catch {
        return undefined
      }
      if (line === '') return undefined
      // Empty it before returning: the dialog is modal, and a second tick must
      // not queue the same conflict behind it.
      writeFileSync(conflictFile, '')
      const path = line.split('\t')[0] ?? ''
      return path === '' ? undefined : path
    },
    leaveCommitted: () => existsSync(leaveFile),
    resetLeave: () => {
      rmSync(leaveFile, { force: true })
    },
  })
}

/** Cordis object-form plugin. */
export const editorPlugin = { name: 'hulala-editor', apply }
