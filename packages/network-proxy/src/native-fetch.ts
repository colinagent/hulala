/** Proxy selection for Bun's native fetch, with the same host rules as Undici. */
export function proxyForUrl(input: string | URL | Request, config: { httpProxy?: string; httpsProxy?: string; noProxy?: string }): string | false {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  // Internal Host tokens and local providers never travel through an HTTP proxy.
  if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]') return false
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  for (const entry of (config.noProxy || '').toLowerCase().split(/[,\s]+/)) {
    if (!entry) continue
    if (entry === '*') return false
    const match = entry.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/)
    const excluded = (match?.[1] || entry).replace(/^\*?\./, '')
    if (match?.[2] && match[2] !== port) continue
    if (host === excluded || host === `[${excluded}]` || host.endsWith('.' + excluded)) return false
  }
  return (url.protocol === 'https:' ? config.httpsProxy || config.httpProxy : config.httpProxy) || false
}

/** Keep native Web streams and cancellation together on Bun. Undici's Node
 * stream.isReadable guard cannot identify Bun Web streams (it returns null). */
export function createNativeProxyFetch(native: typeof globalThis.fetch, config: { httpProxy?: string; httpsProxy?: string; noProxy?: string }, lifetime: AbortSignal): typeof globalThis.fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const caller = init?.signal === undefined && typeof input === 'object' && 'signal' in input ? input.signal : init?.signal
    const signal = caller ? AbortSignal.any([caller, lifetime]) : lifetime
    const proxy = proxyForUrl(input, config)
    return native(input, { ...init, signal, proxy: proxy ? { url: proxy, respectNoProxy: false } : false } as RequestInit)
  }) as typeof globalThis.fetch
}
