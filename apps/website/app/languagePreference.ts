/**
 * How the site picks a language for a visitor who has not picked one yet.
 *
 * The rule is deliberately narrow: the root (`/`) is the only URL that negotiates,
 * because it is the only URL that does not already name a language. A prefixed URL
 * (`/zh-CN/…`) or an unprefixed deep link (`/download/`, `/blog/<slug>/`) is served
 * exactly as addressed, so a link someone shared never changes language underneath
 * them, and a crawler always receives the page its URL says.
 *
 * The order is: an explicit `?lang=` (the switch control), then the remembered
 * choice, then `Accept-Language`, then English. `Accept-Language` is a guess and is
 * never stored; only an explicit choice is remembered, so a visitor who switched
 * once is not guessed at again.
 *
 * @module hulala/website/languagePreference
 */
import { DEFAULT_LOCALE, LOCALES, type SiteLocale } from './i18n'

/** The cookie that remembers an explicit language choice. */
export const LANGUAGE_COOKIE = 'hulala-lang'

/** How long a choice is remembered. */
const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Whether a value names one of the site's languages. */
export function isSupportedLanguage(value: string | null | undefined): value is SiteLocale {
  return value !== null && value !== undefined && (LOCALES as readonly string[]).includes(value)
}

/**
 * One cookie's value from a `Cookie` request header.
 * @param header - the request's `Cookie` header, or null.
 * @param name - the cookie to read.
 * @returns the value, or undefined when the cookie is absent.
 */
export function readCookie(header: string | null, name: string): string | undefined {
  if (header === null) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
  }
  return undefined
}

/**
 * The language an `Accept-Language` header asks for, among the ones the site has.
 *
 * Entries are considered in quality order, and only a language the site actually
 * serves can win: `de-DE,de;q=0.9,zh-CN;q=0.4` resolves to Chinese because German is
 * not served, while `en-US,en;q=0.9,zh;q=0.8` resolves to English. A header the
 * site cannot use resolves to undefined, which lets the caller keep the default.
 * @param header - the request's `Accept-Language` header, or null.
 * @returns the preferred served language, or undefined.
 */
export function preferredLocale(header: string | null): SiteLocale | undefined {
  if (header === null) return undefined
  const entries = header
    .split(',')
    .map(part => {
      const [tag = '', ...parameters] = part.trim().split(';')
      const quality = parameters
        .map(parameter => parameter.trim())
        .find(parameter => parameter.startsWith('q='))
      const value = quality === undefined ? 1 : Number(quality.slice(2))
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(value) ? value : 0 }
    })
    .filter(entry => entry.tag !== '' && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality)
  for (const { tag } of entries) {
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN'
    if (tag === 'en' || tag.startsWith('en-')) return DEFAULT_LOCALE
  }
  return undefined
}

/**
 * The `Set-Cookie` value that remembers a choice.
 * @param locale - the language the visitor chose.
 * @param secure - whether the request came over https.
 * @returns the header value.
 */
export function languageCookie(locale: SiteLocale, secure: boolean): string {
  return `${LANGUAGE_COOKIE}=${locale}; Path=/; Max-Age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`
}
