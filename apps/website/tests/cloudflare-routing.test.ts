import { test, expect } from 'bun:test'
import worker from '../worker.cloudflare'

const env = { ASSETS: { fetch: async () => new Response('static page') } }
test('canonical redirects preserve the path and query', async () => {
  const response = await worker.fetch(new Request('https://www.hulala.ai/zh-CN/download/?from=nav'), env)
  expect(response.status).toBe(308)
  expect(response.headers.get('location')).toBe('https://hulala.ai/zh-CN/download/?from=nav')
})
test('installer endpoints redirect to R2 and reject writes', async () => {
  for (const path of ['/install.sh', '/web-releases.json']) {
    const response = await worker.fetch(new Request('https://hulala.ai' + path), env)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://downloads.hulala.ai/hulala/web/latest' + path)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await worker.fetch(new Request('https://hulala.ai' + path, { method: 'POST' }), env)).status).toBe(405)
  }
})
test('ordinary requests stay on Cloudflare static assets', async () => {
  const response = await worker.fetch(new Request('https://hulala.ai/download/'), env)
  expect(await response.text()).toBe('static page')
})
