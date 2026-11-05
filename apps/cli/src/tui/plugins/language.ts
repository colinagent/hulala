/**
 * The client language service and the first-use prompt.
 *
 * The service owns the active code, the saved preference and the change
 * listeners. The prompt is shown after the first frame (the app emits
 * `hulala/first-frame`), so a slow Host never delays the window and the user
 * never selects a language over a blank screen.
 *
 * @module hulala-cli/tui/plugins/language
 */
import type { Context } from '@deepseek-ai/cordis'
import type { LanguageCode, LanguageProblem, ResolvedLanguage } from '../../language.js'
import { writeClientLanguage } from '../../language.js'
import { setActiveLanguage, t } from '../i18n/index.js'
import { LanguageOverlay } from '../view/overlays/language.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The interface language and the surface `/language` opens. */
    hulalaLanguage: TuiLanguage
  }
  interface Events {
    /** The interactive screen has painted its first frame. */
    'hulala/first-frame'(): void
  }
}

/** What the client reads and changes. */
export interface TuiLanguage {
  readonly current: LanguageCode
  readonly source: ResolvedLanguage['source']
  readonly problem?: LanguageProblem
  /** Translate in the active language. */
  readonly t: typeof t
  /**
   * Switch and persist. The switch always takes effect in this window; a failed
   * write is returned so the caller can say the choice will not survive a
   * restart.
   */
  set(code: LanguageCode): string | undefined
  /** Open the same picker `/language` uses; resolves undefined on Escape. */
  pick(options?: { problem?: LanguageProblem; guess?: LanguageCode }): Promise<LanguageCode | undefined>
  /** Run after every switch; returns an unsubscribe. */
  onChange(handler: () => void): () => void
}

export interface LanguagePluginConfig {
  readonly dataRoot: string
  readonly resolved: ResolvedLanguage
  readonly color: boolean
  /** Show the first-use prompt when the resolved source is unset. */
  readonly prompt: boolean
  /** Locale guess for the initial cursor; never a decision. */
  readonly guess?: LanguageCode
}

/** Provide the service and, when needed, the first-use prompt. */
export function apply(ctx: Context, config: LanguagePluginConfig): void {
  const overlays = ctx.hulalaOverlays
  const render = ctx.hulalaRender
  const lifecycle = ctx.hulalaLifecycle
  const { reducer } = ctx.hulalaViewModel

  let current = config.resolved.code
  let source: ResolvedLanguage['source'] = config.resolved.source
  let problem: LanguageProblem | undefined = config.resolved.problem
  let prompted = false
  const listeners = new Set<() => void>()
  setActiveLanguage(current)

  const pick = (options: { problem?: LanguageProblem; guess?: LanguageCode } = {}): Promise<LanguageCode | undefined> =>
    overlays.modal<LanguageCode | undefined>(done => new LanguageOverlay({
      color: config.color,
      current,
      ...(options.guess === undefined ? {} : { guess: options.guess }),
      ...(options.problem === undefined ? {} : { problem: options.problem }),
      onChoose: done,
      onCancel: () => done(undefined),
    }), { anchor: 'center', width: 64 })

  const set = (code: LanguageCode): string | undefined => {
    let failure: string | undefined
    try {
      writeClientLanguage(config.dataRoot, code)
      source = 'config'
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught)
      source = 'unset'
    }
    current = code
    problem = undefined
    setActiveLanguage(code)
    for (const listener of listeners) listener()
    render.request(true)
    return failure
  }

  ctx.provide('hulalaLanguage', {
    get current() { return current },
    get source() { return source },
    get problem() { return problem },
    t,
    set,
    pick,
    onChange: (handler: () => void) => {
      listeners.add(handler)
      return () => { listeners.delete(handler) }
    },
  })

  ctx.effect(() => () => listeners.clear(), 'hulala: language listeners')
  // One window per process in production; tests (and a future embedder) create
  // several contexts in one process, so the module table must not outlive the
  // window that set it.
  ctx.effect(() => () => setActiveLanguage('en'), 'hulala: reset language')

  if (config.prompt && config.resolved.source === 'unset') {
    ctx.on('hulala/first-frame', () => {
      if (prompted || lifecycle.closing) return
      prompted = true
      void (async () => {
        const code = await pick({
          ...(problem === undefined ? {} : { problem }),
          ...(config.guess === undefined ? {} : { guess: config.guess }),
        })
        if (code === undefined) return
        const failure = set(code)
        if (failure !== undefined) {
          reducer.addError(t('language.saveFailed', { reason: failure }))
          render.repaint()
        }
      })()
    })
  }
}

/** Cordis object-form plugin. */
export const languagePlugin = {
  name: 'hulala-language',
  inject: ['hulalaOverlays', 'hulalaRender', 'hulalaLifecycle', 'hulalaViewModel'],
  apply,
}
