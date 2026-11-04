export interface Download {
  key: string
  size: number
  sha256: string
  fallback?: string
  static?: boolean
  objectKey?: string
  retired?: boolean
}
interface StoredObject {
  size: number
  httpEtag: string
  body?: ReadableStream<Uint8Array>
  writeHttpMetadata(headers: Headers): void
}
export interface GatewayEnv {
  RELEASES: {
    head(key: string): Promise<StoredObject | null>
    get(key: string, options?: { range: { offset: number; length: number } }): Promise<StoredObject | null>
  }
  QUOTA: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export function byteRange(value: string, size: number): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2]) || size <= 0) return null
  const first = match[1] ? Number(match[1]) : undefined
  const last = match[2] ? Number(match[2]) : undefined
  if ((first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last))) return null
  if (first === undefined) {
    if (!last) return null
    const length = Math.min(last, size)
    return { offset: size - length, length }
  }
  if (first >= size || (last !== undefined && last < first)) return null
  return { offset: first, length: Math.min(last ?? size - 1, size - 1) - first + 1 }
}

function fallback(item: Download): Response {
  // Only exact, hash-verified GitHub assets may be used. Never redirect an updater
  // ZIP to a differently packaged installer or propagate a caller's query string.
  if (item.fallback && /^https:\/\/github\.com\/colinagent\/hulala\/releases\/download\//.test(item.fallback)) {
    return new Response(null, { status: 307, headers: { location: item.fallback, 'cache-control': 'no-store', 'x-hulala-source': 'github' } })
  }
  return new Response('Download quota reached. Please retry later.', { status: 503, headers: { 'retry-after': '3600', 'cache-control': 'no-store' } })
}

export function createGateway(catalog: Download[]) {
  const byPath = new Map(catalog.map(item => ['/' + item.key, item]))
  return {
    async fetch(request: Request, env: GatewayEnv): Promise<Response> {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
      const url = new URL(request.url)
      let pathname: string
      try { pathname = decodeURIComponent(url.pathname) } catch { return new Response(null, { status: 400 }) }
      const item = byPath.get(pathname)
      if (!item) return new Response('Not found', { status: 404 })
      if (item.retired) return item.fallback ? fallback(item) : new Response('This release is no longer hosted.', { status: 410 })
      if (item.static) {
        url.pathname = pathname
        url.search = ''
        return env.ASSETS.fetch(new Request(url, { method: request.method, headers: request.headers }))
      }
      const etag = `"sha256-${item.sha256}"`
      const ifRange = request.headers.get('if-range')
      const rangeHeader = request.method === 'GET' && (!ifRange || ifRange === etag) ? request.headers.get('range') : null
      const range = rangeHeader ? byteRange(rangeHeader, item.size) : undefined
      if (rangeHeader && !range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${item.size}` } })
      try {
        const quota = env.QUOTA.get(env.QUOTA.idFromName('hulala-downloads-v1'))
        const allowed = await quota.fetch(new Request('https://quota.internal/reserve', { method: 'POST' }))
        if (allowed.status !== 204) return fallback(item)
        // Exactly one R2 read per reservation. No automatic retries or preflight HEAD.
        const object = request.method === 'HEAD'
          ? await env.RELEASES.head(item.objectKey ?? item.key)
          : await env.RELEASES.get(item.objectKey ?? item.key, range ? { range } : undefined)
        if (!object || object.size !== item.size) {
          await object?.body?.cancel()
          return fallback(item)
        }
        const headers = new Headers({ 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', 'x-hulala-source': 'r2' })
        object.writeHttpMetadata(headers)
        headers.set('etag', etag)
        headers.set('cache-control', 'public, max-age=3600')
        const conditions = request.headers.get('if-none-match')?.split(',').map(x => x.trim().replace(/^W\//, ''))
        if (conditions?.includes(etag) || conditions?.includes('*')) {
          await object.body?.cancel()
          return new Response(null, { status: 304, headers })
        }
        headers.set('content-length', String(range?.length ?? object.size))
        if (range) headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`)
        return new Response(request.method === 'HEAD' ? null : object.body, { status: range ? 206 : 200, headers })
      } catch {
        // Counter/storage failure must never fall through to unmetered R2 access.
        return fallback(item)
      }
    },
  }
}
