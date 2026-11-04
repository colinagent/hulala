interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

const downloads = new Set(['/install.sh', '/web-releases.json'])

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname === 'www.hulala.ai') {
      url.hostname = 'hulala.ai'
      url.protocol = 'https:'
      url.port = ''
      return new Response(null, { status: 308, headers: { location: url.href } })
    }
    if (downloads.has(url.pathname)) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
      const target = new URL('https://downloads.hulala.ai/hulala/web/latest' + url.pathname)
      target.search = url.search
      return new Response(null, { status: 302, headers: { location: target.href, 'cache-control': 'no-store' } })
    }
    return env.ASSETS.fetch(request)
  },
}
