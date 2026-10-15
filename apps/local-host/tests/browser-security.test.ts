import { expect, test } from 'bun:test'
import { browserAuthenticated, browserCookie, browserRequestError } from '../src/browser/security'

test('checks exact browser Host and Origin and rejects cross-site and opaque origins', () => {
  const authorities = new Set(['hulala.localhost:3210'])
  const request = (headers: Record<string, string> = {}, url = 'http://hulala.localhost:3210/') => new Request(url, { headers: { host: new URL(url).host, ...headers } })
  expect(browserRequestError(request(), authorities)).toBeUndefined()
  expect(browserRequestError(request({ origin: 'http://hulala.localhost:3210' }), authorities)).toBeUndefined()
  for (const origin of ['null', 'https://evil.example', 'http://other.localhost:3210', 'http://hulala.localhost:3211']) expect(browserRequestError(request({ origin }), authorities)).toBeDefined()
  expect(browserRequestError(request({ 'sec-fetch-site': 'cross-site' }), authorities)).toBeDefined()
  expect(browserRequestError(request({ 'x-forwarded-host': 'hulala.localhost:3210' }, 'http://evil.example:3210/'), authorities)).toBeDefined()
})

test('uses an HttpOnly process-scoped cookie instead of tokens in URLs or browser state', () => {
  const token = 'example-process-token'
  const cookie = browserCookie('hulala_test', token)
  expect(cookie).toContain('HttpOnly; SameSite=Strict')
  expect(browserAuthenticated(new Request('http://hulala.localhost/?token=' + token), 'hulala_test', token)).toBe(false)
  expect(browserAuthenticated(new Request('http://hulala.localhost/', { headers: { cookie: 'hulala_test=' + token } }), 'hulala_test', token)).toBe(true)
  expect(browserAuthenticated(new Request('http://hulala.localhost/', { headers: { cookie: 'hulala_test=wrong' } }), 'hulala_test', token)).toBe(false)
})
