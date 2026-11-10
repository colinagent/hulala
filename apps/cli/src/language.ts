/**
 * The client's own interface language, stored beside its other preferences.
 *
 * Language is a *client* preference: it lives in `<data>/config/client.json`,
 * not in the Host, so two windows attached to one Host may use different
 * languages. `HULALA_LANG` is an explicit override for tests and headless use;
 * it is not persisted and does not count as "the user chose".
 *
 * "Unset" is a real state, not an alias for English. The terminal client asks
 * once per launch while it is unset; a saved choice is never asked again.
 *
 * @module hulala-cli/language
 */
import { readClientPreferences, updateClientPreferences } from './clientPreferences.js'

export { clientConfigPath } from './clientPreferences.js'

/** The languages this client ships messages for. */
export type LanguageCode = 'en' | 'zh-CN'

/** Where the active language came from. */
export type LanguageSource = 'environment' | 'config' | 'unset'

/** Why a saved or overridden language could not be used. */
export type LanguageProblem =
  | { readonly kind: 'environment'; readonly value: string }
  | { readonly kind: 'config'; readonly reason: string }

/** The language plus the reason it is active. */
export interface ResolvedLanguage {
  readonly code: LanguageCode
  readonly source: LanguageSource
  readonly problem?: LanguageProblem
}

/** What `client.json` held, or why it could not be read. */
export interface ClientLanguageRecord {
  readonly language?: LanguageCode
  readonly problem?: string
}

/** Normalize one language spelling.
 *
 * The picker only ever writes `en` or `zh-CN`, but a person editing
 * `client.json` or exporting `HULALA_LANG` may type a POSIX or English name.
 * @param value - the raw spelling.
 * @returns the canonical code, or undefined when it names no shipped language.
 */
export function parseLanguage(value: string): LanguageCode | undefined {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'en' || normalized === 'english') return 'en'
  if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh_cn' || normalized === '中文') return 'zh-CN'
  return undefined
}

/** The label of one language as its own speakers write it. */
export function languageName(code: LanguageCode): string {
  return code === 'en' ? 'English' : '中文（简体）'
}

/**
 * Read the saved language without throwing.
 *
 * A missing file is ordinary (fresh install). A malformed one is reported so
 * the picker can say why it is asking again instead of silently overwriting it.
 * @param dataRoot - the Hulala state root.
 * @returns the saved code, or the reason there is none.
 */
export function readClientLanguage(dataRoot: string): ClientLanguageRecord {
  const read = readClientPreferences(dataRoot)
  // No file is the ordinary fresh install, not a problem to report.
  if (!read.present) return {}
  if (read.problem !== undefined) return { problem: read.problem }
  const saved = read.values.language
  if (typeof saved !== 'string') return { problem: 'client.json has no language' }
  const code = parseLanguage(saved)
  return code === undefined ? { problem: `unsupported language "${saved}"` } : { language: code }
}

/**
 * Persist the user's choice atomically.
 *
 * The file is a preference, not a secret, but it lives under `config/` and is
 * still written user-only: one small file cannot leak a token, and a crash
 * between truncate and write must not leave a half document.
 * @param dataRoot - the Hulala state root.
 * @param code - the language the user chose.
 */
export function writeClientLanguage(dataRoot: string, code: LanguageCode): void {
  updateClientPreferences(dataRoot, { language: code })
}

/**
 * Resolve the language for this launch.
 *
 * Priority is explicit environment, then the saved choice, then unset. A bad
 * `HULALA_LANG` is reported and treated as unset rather than falling through to
 * the file: the person asked for that language, and silently using another one
 * would hide the typo.
 * @param env - environment to read `HULALA_LANG` from.
 * @param dataRoot - the Hulala state root.
 * @returns the active code and why it won.
 */
export function resolveLanguage(env: NodeJS.ProcessEnv, dataRoot: string): ResolvedLanguage {
  const override = env.HULALA_LANG?.trim()
  if (override !== undefined && override !== '') {
    const code = parseLanguage(override)
    return code === undefined
      ? { code: 'en', source: 'unset', problem: { kind: 'environment', value: override } }
      : { code, source: 'environment' }
  }
  const saved = readClientLanguage(dataRoot)
  if (saved.problem !== undefined) {
    return { code: 'en', source: 'unset', problem: { kind: 'config', reason: saved.problem } }
  }
  return saved.language === undefined
    ? { code: 'en', source: 'unset' }
    : { code: saved.language, source: 'config' }
}

/**
 * The language the first-use picker puts its cursor on.
 *
 * This is only a cursor position, never a resolved choice: a Chinese-locale
 * shell makes `中文（简体）` the likely answer, but the user still confirms it.
 * @param env - environment to read locale variables from.
 * @returns the guessed language.
 */
export function guessLanguage(env: NodeJS.ProcessEnv): LanguageCode {
  const locale = env.LC_ALL?.trim() || env.LC_MESSAGES?.trim() || env.LANG?.trim() || ''
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}
