/**
 * The active client-language table and the one translator.
 *
 * One terminal window is one process, so the active table is module state set
 * by the language plugin before the first frame. Views call `t()` at render
 * time; a switch only has to request a repaint, not rebuild components.
 *
 * @module hulala-cli/tui/i18n
 */
import type { LanguageCode, LanguageProblem } from '../../language.js'
import { languageName } from '../../language.js'
import type { MessageKey, MessageParameters } from './messages.js'
import { en } from './en.js'
import { zhCN } from './zh-CN.js'

export type { MessageKey, MessageTable } from './messages.js'
export { languageName }

let active: LanguageCode = 'en'

/** Set the table every subsequent `t()` reads. */
export function setActiveLanguage(code: LanguageCode): void {
  active = code
}

/** The table currently in use. */
export function activeLanguage(): LanguageCode {
  return active
}

/**
 * Translate one key in the active language.
 * @param key - a key from `MessageTable`.
 * @param args - the interpolation parameters that key declares.
 * @returns the rendered message.
 */
export function t<K extends MessageKey>(key: K, ...args: MessageParameters<K>): string {
  const value = (active === 'zh-CN' ? zhCN : en)[key]
  if (typeof value === 'string') return value
  const render = value as unknown as (...params: MessageParameters<K>) => string
  return render(...args)
}

/** Render a first-use problem in the active language. */
export function languageProblemText(problem: LanguageProblem): string {
  return problem.kind === 'environment'
    ? t('language.problemEnv', { value: problem.value })
    : t('language.problemConfig', { reason: problem.reason })
}
