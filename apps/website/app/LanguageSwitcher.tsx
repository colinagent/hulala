/**
 * The language switch: one link, one click.
 *
 * The control shows the language you would arrive at, named in that language, and
 * is the only interactive part of the header that changes the page's language. It
 * is a real `<a>` to a real URL — not a client-side flag — so it works without
 * JavaScript, can be opened in a new tab, and is announced by a screen reader as a
 * link to `lang="zh-CN"` (or `lang="en"`) content.
 *
 * The current language is deliberately not a second link: the page in front of the
 * reader already is that language, and a link to where you already are only
 * reloads the page. The `?lang=` on the target is the choice, not the page: the
 * edge worker stores it and redirects to the clean URL.
 *
 * @module hulala/website/LanguageSwitcher
 */
import { HTML_LANG, LOCALE_LABEL, otherLocale, switchHref, type SiteLocale } from './i18n'

/** What the link is called, in the language being left. */
const SWITCH_LABEL: Readonly<Record<SiteLocale, string>> = {
  en: 'Switch language to 中文',
  'zh-CN': '切换到英文',
}

/**
 * The header's language link.
 * @param props.locale - the language of the page being read.
 * @param props.path - that page's unprefixed path (`/`, `/download/`, `/blog/<slug>/`).
 */
export default function LanguageSwitcher({ locale, path }: { locale: SiteLocale; path: string }) {
  const target = otherLocale(locale)
  return (
    <a
      className="language-switcher static-glass"
      href={switchHref(locale, path)}
      hrefLang={HTML_LANG[target]}
      lang={HTML_LANG[target]}
      aria-label={SWITCH_LABEL[locale]}
    >
      {LOCALE_LABEL[target]}
    </a>
  )
}
