import { afterEach, expect, test } from 'bun:test'
import { BrowserApiError, browserJson, openBrowserWorkspace, openRemoteWorkspace } from './browser'

const originals = new Map<string, PropertyDescriptor | undefined>()
const provisionalDocument = () => ({ title: '', createElement: () => ({ setAttribute() {}, textContent: '' }), querySelector: () => ({ textContent: '' }), body: { append() {}, style: { cssText: '' } } })
function replace(name: string, value: unknown): void {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  originals.clear()
})

test('reserves a browser tab during the user action before asynchronous Workspace registration', async () => {
  let complete!: (response: Response) => void
  let opened = false
  let navigated = ''
  const page = { opener: {}, closed: false, document: provisionalDocument(), location: { replace(value: string) { navigated = value } }, close() { this.closed = true } }
  replace('location', { pathname: '/w/current' })
  replace('window', { open() { opened = true; return page }, dispatchEvent() {} })
  replace('fetch', () => new Promise<Response>(resolve => { complete = resolve }))
  const opening = openBrowserWorkspace('/fixture/项目')
  expect(opened).toBe(true)
  expect(page.opener).toBeNull()
  expect(navigated).toBe('')
  complete(Response.json({ id: 'next-workspace', name: '项目', path: '/fixture/项目' }, { status: 201 }))
  await opening
  expect(navigated).toBe('/w/next-workspace')
})

test('reports a clickable Workspace URL when the browser blocks the new tab', async () => {
  let notice: any
  replace('location', { pathname: '/w/current' })
  replace('window', { open: () => null, dispatchEvent(event: CustomEvent) { notice = event.detail } })
  replace('fetch', async () => Response.json({ id: 'next-workspace', name: '项目' }))
  await openBrowserWorkspace('/fixture/项目')
  expect(notice).toEqual({ url: '/w/next-workspace', name: '项目' })
})

test('renews a restarted local session once without putting a token in browser requests', async () => {
  const requests: string[] = []
  replace('location', { pathname: '/w/workspace-id' })
  replace('fetch', async (url: string) => {
    requests.push(url)
    if (requests.length === 1) return Response.json({ code: 'browser_session_required' }, { status: 401 })
    if (requests.length === 2) return new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
    return Response.json({ value: 'ready' })
  })
  expect(await browserJson('/api/browser/workspaces/workspace-id/bootstrap')).toEqual({ value: 'ready' })
  expect(requests).toEqual(['/api/browser/workspaces/workspace-id/bootstrap', '/w/workspace-id', '/api/browser/workspaces/workspace-id/bootstrap'])
})

test('preserves typed API failures and closes an unsuccessful provisional tab', async () => {
  let closed = false
  replace('location', { pathname: '/w/current' })
  replace('window', { open: () => ({ opener: null, closed: false, document: provisionalDocument(), close() { closed = true } }) })
  replace('fetch', async () => Response.json({ code: 'file_not_found', message: 'Directory no longer exists' }, { status: 404 }))
  try { await openBrowserWorkspace('/fixture/missing'); throw new Error('expected rejection') }
  catch (error) {
    expect(error).toBeInstanceOf(BrowserApiError)
    expect((error as BrowserApiError).status).toBe(404)
    expect((error as BrowserApiError).code).toBe('file_not_found')
  }
  expect(closed).toBe(true)
})

test('declining an SSH fingerprint closes the provisional view without trusting or retrying the host', async () => {
  let closed = false, confirmations = 0
  const requests: string[] = []
  replace('location', { pathname: '/w/current' })
  replace('window', { open: () => ({ opener: null, closed: false, document: provisionalDocument(), close() { closed = true } }), confirm: () => { confirmations++; return false }, dispatchEvent() {} })
  replace('fetch', async (url: string) => {
    requests.push(url)
    if (url.endsWith('/open')) return Response.json({ code: 'ssh_host_key_unknown', message: 'Confirm host identity' }, { status: 409 })
    return Response.json({ challenge: { endpoint: '[fixture]:22', fingerprint: 'SHA256:' + 'A'.repeat(43) } })
  })
  await openRemoteWorkspace({ id: 'fixture-host', alias: 'Fixture' })
  expect(confirmations).toBe(1)
  expect(closed).toBeTrue()
  expect(requests).toEqual(['/api/browser/ssh/open', '/api/browser/ssh/hosts/fixture-host/trust'])
})
