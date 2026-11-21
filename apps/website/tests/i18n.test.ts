import { test, expect } from 'bun:test'
import worker from '../worker.cloudflare'
import { blogPath, localePath, switchHref } from '../app/i18n'
import { languageCookie, preferredLocale, readCookie } from '../app/languagePreference'
import sitemap from '../app/sitemap'

const env = { ASSETS: { fetch: async () => new Response('static page') } }
const call = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  worker.fetch(new Request(`https://hulala.ai${path}`, { method, headers }), env)

test('every path is built from the locale, not concatenated by hand', () => {
  expect(localePath('en', '/')).toBe('/')
  expect(localePath('en', '/download/')).toBe('/download/')
  expect(localePath('zh-CN', '/')).toBe('/zh-CN/')
  expect(localePath('zh-CN', '/download/')).toBe('/zh-CN/download/')
  expect(blogPath('en')).toBe('/blog/')
  expect(blogPath('zh-CN', 'a-post')).toBe('/zh-CN/blog/a-post/')
})

test('a language switch is a link to the other language of the same page', () => {
  expect(switchHref('en', '/blog/a-post/')).toBe('/zh-CN/blog/a-post/?lang=zh-CN')
  expect(switchHref('zh-CN', '/')).toBe('/?lang=en')
  expect(switchHref('zh-CN', '/download/')).toBe('/download/?lang=en')
})

test('Accept-Language only wins for a language the site serves', () => {
  expect(preferredLocale('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh-CN')
  expect(preferredLocale('en-US,en;q=0.9,zh;q=0.8')).toBe('en')
  expect(preferredLocale('de-DE,de;q=0.9,zh-CN;q=0.4')).toBe('zh-CN')
  expect(preferredLocale('FR-fr')).toBeUndefined()
  expect(preferredLocale('zh;q=0')).toBeUndefined()
  expect(preferredLocale(null)).toBeUndefined()
})

test('only an explicit choice is remembered, and only over its own path', () => {
  expect(readCookie('a=1; hulala-lang=zh-CN; b=2', 'hulala-lang')).toBe('zh-CN')
  expect(readCookie(null, 'hulala-lang')).toBeUndefined()
  expect(languageCookie('en', true)).toContain('Secure')
  expect(languageCookie('en', false)).not.toContain('Secure')
})

test('the root negotiates, and nothing else does', async () => {
  const chinese = { 'accept-language': 'zh-CN,zh;q=0.9' }
  const root = await call('/', chinese)
  expect(root.status).toBe(307)
  expect(root.headers.get('location')).toBe('https://hulala.ai/zh-CN/')
  expect(root.headers.get('cache-control')).toBe('no-store')

  // A prefixed URL already names its language.
  expect((await call('/zh-CN/', chinese)).status).toBe(200)
  // An unprefixed deep link is the page someone linked to; keep it.
  expect((await call('/download/', chinese)).status).toBe(200)
  expect((await call('/blog/a-post/', chinese)).status).toBe(200)
  // A remembered choice beats the header.
  expect((await call('/', { ...chinese, cookie: 'hulala-lang=en' })).status).toBe(200)
  // No header, no cookie: the default language.
  expect((await call('/')).status).toBe(200)
})

test('the switch query records the choice and leaves the URL clean', async () => {
  const response = await call('/download/?lang=en', { cookie: 'hulala-lang=zh-CN' })
  expect(response.status).toBe(307)
  expect(response.headers.get('location')).toBe('https://hulala.ai/download/')
  expect(response.headers.get('set-cookie')).toContain('hulala-lang=en')
  expect(response.headers.get('cache-control')).toBe('no-store')
})

test('a server component request or a non-GET is not a language decision', async () => {
  const chinese = { 'accept-language': 'zh-CN' }
  expect((await call('/?_rsc=abc', chinese)).status).toBe(200)
  expect((await call('/', { ...chinese, rsc: '1' })).status).toBe(200)
  expect((await call('/', chinese, 'POST')).status).toBe(200)
})

test('the sitemap lists both languages of each page with their alternates', async () => {
  const entries = await sitemap()
  for (const [english, chinese] of [['/', '/zh-CN/'], ['/download/', '/zh-CN/download/']]) {
    for (const path of [english, chinese]) {
      const entry = entries.find(item => item.url === `https://hulala.ai${path}`)
      expect(entry).toBeDefined()
      expect(entry?.alternates?.languages?.en).toBe(`https://hulala.ai${english}`)
      expect(entry?.alternates?.languages?.['zh-CN']).toBe(`https://hulala.ai${chinese}`)
      expect(entry?.alternates?.languages?.['x-default']).toBe(`https://hulala.ai${english}`)
    }
  }
})
