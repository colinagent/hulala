import { timingSafeEqual } from 'node:crypto'

export function browserRequestError(request: Request, authorities: ReadonlySet<string>): string | undefined {
  const url = new URL(request.url)
  if (!authorities.has(url.host) || request.headers.get('host') !== url.host) return 'Host is not allowed'
  if (request.headers.get('sec-fetch-site') === 'cross-site') return 'Cross-site requests are not allowed'
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== url.origin) return 'Origin is not allowed'
  return undefined
}

export function browserAuthenticated(request: Request, cookieName: string, token: string): boolean {
  const cookie = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
  if (!cookie) return false
  const expected = Buffer.from(token)
  const actual = Buffer.from(cookie)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function browserCookie(name: string, token: string): string {
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict`
}
