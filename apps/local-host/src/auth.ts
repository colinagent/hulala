import { CONNECTION_TOKEN_HEADER } from '@hulala/workbench-contracts'

export function createConnectionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Buffer.from(bytes).toString('base64url')
}

export function connectionCookieName(instanceId: string): string {
  return `hulala_${instanceId.replace(/[^A-Za-z0-9]/g, '_')}`
}

export function allowedLocalOrigin(origin: string | null): boolean {
  if (origin === null || origin === '' || origin === 'null') return false
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:')
        && (url.hostname === 'localhost'
          || url.hostname.endsWith('.localhost')
          || url.hostname === '127.0.0.1'
          || url.hostname === '[::1]')
  } catch {
    return false
  }
}

export function requestToken(request: Request, cookieName: string): string {
  const cookieToken = request.headers.get('cookie')
    ?.split(';')
    .map(value => value.trim().split('='))
    .find(([name]) => name === cookieName)?.[1]
  return request.headers.get(CONNECTION_TOKEN_HEADER) ?? cookieToken ?? ''
}

export function authorizeRequest(request: Request, expectedToken: string, cookieName: string): boolean {
  const origin = request.headers.get('origin')
  const requestOrigin = new URL(request.url).origin
  const sameOrigin = origin === requestOrigin
  const headerToken = request.headers.get(CONNECTION_TOKEN_HEADER) ?? ''
  if (headerToken === expectedToken) {
    // The Electron renderer can run from the Vite development origin while
    // resources stream from this loopback server on a different port. The
    // main process injects the process-scoped token only for those resource
    // requests, so permit other validated loopback origins as well.
    return origin === null || sameOrigin || allowedLocalOrigin(origin)
  }
  return sameOrigin && requestToken(request, cookieName) === expectedToken
}
