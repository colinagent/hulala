import { languageCookie, readCookie, preferredLocale } from './app/languagePreference'
import { DEFAULT_LOCALE, localePath } from './app/i18n'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

const downloads = new Set(['/install.sh', '/web-releases.json'])

/**
 * The language a request should be answered in, or undefined to serve it as
 * addressed.
 *
 * Only the root negotiates. A prefixed URL (`/zh-CN/…`) already names its
 * language, and an unprefixed deep link (`/download/`, `/blog/<slug>/`) is the
 * English page someone linked to on purpose; rewriting either would change the
 * page under a shared link and under a crawler. `?lang=` is not negotiation: the
 * switch control put it there, so it is honoured everywhere, recorded as the
 * visitor's choice, and removed from the URL.
 * @param request - the incoming request.
 * @param url - its URL.
 * @returns a redirect response, or undefined to keep going.
 */
function languageRedirect(request: Request, url: URL): Response | undefined {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined
  const explicit = url.searchParams.get('lang')
  if (explicit === 'en' || explicit === 'zh-CN') {
    const clean = new URL(url)
    clean.searchParams.delete('lang')
    return new Response(null, {
      status: 307,
      headers: {
        location: new URL(clean.pathname + clean.search, url).href,
        // The choice is a cookie, not a URL: the page itself is unchanged.
        'set-cookie': languageCookie(explicit, url.protocol === 'https:'),
        'cache-control': 'no-store',
      },
    })
  }
  if (url.pathname !== '/') return undefined
  // A React Server Component request for `/` is part of a navigation the browser
  // is already doing; redirecting it would answer a different document than the
  // one being rendered.
  if (url.searchParams.has('_rsc') || request.headers.get('rsc') !== null) return undefined
  const remembered = readCookie(request.headers.get('cookie'), 'hulala-lang')
  const preferred = remembered === 'en' || remembered === 'zh-CN'
    ? remembered
    : preferredLocale(request.headers.get('accept-language'))
  if (preferred === undefined || preferred === DEFAULT_LOCALE) return undefined
  return new Response(null, {
    status: 307,
    headers: {
      location: new URL(localePath(preferred, '/') + url.search, url).href,
      'cache-control': 'no-store',
      vary: 'accept-language',
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname === 'www.hulala.ai') {
      url.hostname = 'hulala.ai'
      url.protocol = 'https:'
      url.port = ''
      return new Response(null, { status: 308, headers: { location: url.href } })
    }
    const language = languageRedirect(request, url)
    if (language !== undefined) return language
    if (downloads.has(url.pathname)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
      }
      const target = new URL('https://downloads.hulala.ai/hulala/web/latest' + url.pathname)
      target.search = url.search
      return new Response(null, { status: 302, headers: { location: target.href, 'cache-control': 'no-store' } })
    }
    return env.ASSETS.fetch(request)
  },
}
