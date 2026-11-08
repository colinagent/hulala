/**
 * The key-binding service: read the user's file once, publish what is in force.
 *
 * The input pipeline, the composer's menu, `/help` and the startup hints all read
 * the active keymap instead of spelling chords themselves, and `/keys` re-reads
 * the file through this service. A broken file is reported where the reader looks
 * for keys (`/keys` and the first-frame notice) rather than refusing to start: an
 * unbindable key must never cost the window.
 *
 * @module hulala-cli/tui/plugins/keymap
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  KEY_ACTIONS,
  actionHint,
  keymapPath,
  parseKeymap,
  resolveKeymap,
  setActiveKeymap,
  type Keymap,
  type KeymapProblem,
} from '../../keymap.js'
import { t } from '../i18n/index.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The bindings in force and the reason a file line was ignored. */
    hulalaKeymap: TuiKeymap
  }
}

/** What the client reads and reloads. */
export interface TuiKeymap {
  /** Where the file lives, for `/keys`. */
  readonly path: string
  /** Problems from the last read; empty when the file is fine or absent. */
  readonly problems: readonly KeymapProblem[]
  /** Re-read the file and publish the result. */
  reload(): readonly KeymapProblem[]
  /** One problem as a sentence in the active language. */
  describe(problem: KeymapProblem): string
  /** The formatted bindings of one action, or an empty string. */
  hint(id: string): string
  /** The number of actions the active map defines. */
  readonly actionCount: number
}

export interface KeymapPluginConfig {
  /** The Hulala state root; `config/keybindings.json` lives under it. */
  readonly dataRoot: string
}

/** Read, validate and publish the user's bindings. */
export function apply(ctx: Context, config: KeymapPluginConfig): void {
  const render = ctx.hulalaRender
  const lifecycle = ctx.hulalaLifecycle
  const { reducer } = ctx.hulalaViewModel

  let applied: Keymap = resolveKeymap(config.dataRoot)
  setActiveKeymap(applied)

  const describe = (problem: KeymapProblem): string => {
    switch (problem.kind) {
      case 'unreadable': return t('keymap.problem.unreadable', { reason: problem.reason })
      case 'malformed': return t('keymap.problem.malformed', { reason: problem.reason })
      case 'unknownAction': return t('keymap.problem.unknownAction', { action: problem.action })
      case 'badKeys': return t('keymap.problem.badKeys', { action: problem.action })
      case 'badKey': return t('keymap.problem.badKey', { action: problem.action, key: problem.key })
      case 'duplicate': return t('keymap.problem.duplicate', { key: problem.key, first: problem.first, second: problem.second })
      case 'noExit': return t('keymap.problem.noExit')
    }
  }

  const reload = (): readonly KeymapProblem[] => {
    applied = resolveKeymap(config.dataRoot)
    setActiveKeymap(applied)
    render.request(true)
    return applied.problems
  }

  ctx.provide('hulalaKeymap', {
    path: keymapPath(config.dataRoot),
    get problems() { return applied.problems },
    reload,
    describe,
    hint: actionHint,
    actionCount: KEY_ACTIONS.length,
  })

  // The window that ends must not leave its bindings behind: tests (and a future
  // embedder) create several contexts in one process.
  ctx.effect(() => () => setActiveKeymap(parseKeymap({})), 'hulala: reset keymap')

  // A file that was not taken verbatim is reported once the frame exists, next to
  // the other first-frame notices.
  if (applied.problems.length > 0) {
    ctx.on('hulala/first-frame', () => {
      if (lifecycle.closing) return
      for (const problem of applied.problems) reducer.addNotice(`! ${describe(problem)}`, 'warn')
      render.repaint()
    })
  }
}

/** Cordis object-form plugin. */
export const keymapPlugin = {
  name: 'hulala-keymap',
  inject: ['hulalaRender', 'hulalaLifecycle', 'hulalaViewModel'],
  apply,
}
