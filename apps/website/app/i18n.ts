/**
 * The site's languages, in one place.
 *
 * English is the default and lives at the root; Chinese is prefixed with its
 * language tag. That is the "default language unprefixed" pattern: every page has
 * exactly one URL per language, `hreflang` points at the pair, and a language
 * switch is a navigation to a real URL rather than a client-side flag. Every path
 * in the site is built through `localePath`, so a page cannot exist in one
 * language and be missing from the other's link, sitemap or alternate.
 *
 * @module hulala/website/i18n
 */

/** Every language the site serves, in the order the switcher would list them. */
export const LOCALES = ['en', 'zh-CN'] as const

/** One of the site's languages. */
export type SiteLocale = (typeof LOCALES)[number]

/** The language at the root, and the fallback for every unknown visitor. */
export const DEFAULT_LOCALE: SiteLocale = 'en'

/** The short label the switch control shows for a language. */
export const LOCALE_LABEL: Readonly<Record<SiteLocale, string>> = {
  en: 'EN',
  'zh-CN': '中文',
}

/** The value `<html lang>` and `hreflang` use. */
export const HTML_LANG: Readonly<Record<SiteLocale, string>> = {
  en: 'en',
  'zh-CN': 'zh-CN',
}

/** The language a switch from `locale` goes to. */
export function otherLocale(locale: SiteLocale): SiteLocale {
  return locale === DEFAULT_LOCALE ? 'zh-CN' : DEFAULT_LOCALE
}

/**
 * The same page in one language.
 *
 * The input is the language-independent path (`/`, `/download/`, `/blog/<slug>/`),
 * so a caller never concatenates a locale prefix by hand. The default language
 * keeps the path as written; every other language is prefixed with its tag.
 * @param locale - the language the path is wanted in.
 * @param path - the unprefixed path, with its trailing slash.
 * @returns the path to link to.
 */
export function localePath(locale: SiteLocale, path: string): string {
  if (locale === DEFAULT_LOCALE) return path
  return path === '/' ? `/${locale}/` : `/${locale}${path}`
}

/**
 * The switch link's target: the same page in the other language, plus the
 * language it is for.
 *
 * The explicit `?lang=` is what lets the switch work without JavaScript and keeps
 * the remembered choice in step with the page being read: the edge worker records
 * it as a cookie and redirects to the clean URL, so the query never sticks in the
 * address bar or in a shared link.
 * @param locale - the language being left.
 * @param path - the unprefixed path of the page being read.
 * @returns the other language's URL, with the language marked.
 */
export function switchHref(locale: SiteLocale, path: string): string {
  const target = otherLocale(locale)
  return `${localePath(target, path)}?lang=${target}`
}

/** The blog's index, or one post, in one language. */
export function blogPath(locale: SiteLocale, slug?: string): string {
  return localePath(locale, slug === undefined ? '/blog/' : `/blog/${slug}/`)
}
