import { execFileSync } from 'node:child_process'
import { Context, Service } from '@deepseek-ai/cordis'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import {
  Agent as UndiciAgent,
  EnvHttpProxyAgent,
  fetch as undiciFetch,
  getGlobalDispatcher,
  setGlobalDispatcher,
  type Dispatcher,
} from 'undici'

export type ProxyMode = 'auto' | 'manual' | 'off'

export interface ProxySettings {
  mode: ProxyMode
  proxyUrl?: string
}

export interface ProxyState {
  mode: ProxyMode
  source: 'manual' | 'loopwithai-env' | 'environment' | 'macos-system' | 'direct'
  httpProxy?: string
  httpsProxy?: string
  noProxy?: string
  manualConfigured: boolean
  revision: number
  warning?: string
}

export interface ResolvedProxy {
  mode: ProxyMode
  source: ProxyState['source']
  httpProxy?: string
  httpsProxy?: string
  noProxy?: string
  warning?: string
}

interface MacProxyConfig {
  httpProxy?: string
  httpsProxy?: string
  noProxy?: string
  warning?: string
}

const NS = settingsNamespace('loopwithai-network')
const TEST_URL = 'https://api.deepseek.com/models'
const PROXY_KEYS = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'npm_config_proxy', 'npm_config_https_proxy',
  'NPM_CONFIG_PROXY', 'NPM_CONFIG_HTTPS_PROXY',
] as const

export const ProxySettingsSchema = z.object({
  mode: z.union(['auto', 'manual', 'off']).default('auto'),
  proxyUrl: z.string().role('secret'),
}) as z<ProxySettings>

function first(env: NodeJS.ProcessEnv, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return undefined
}

export function validateProxyUrl(value: string): string {
  const trimmed = value.trim()
  let parsed: URL
  try { parsed = new URL(trimmed) } catch { throw new Error('Proxy URL must be a valid absolute URL.') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// proxy URLs are supported.')
  }
  if (!parsed.hostname) throw new Error('Proxy URL must include a host.')
  return parsed.toString()
}

export function redactProxyUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    if (parsed.username) parsed.username = '***'
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch { return '<invalid proxy URL>' }
}

export function parseMacosSystemProxy(output: string): MacProxyConfig {
  const scalar = new Map<string, string>()
  const exceptions: string[] = []
  let inExceptions = false
  for (const line of output.split(/\r?\n/)) {
    if (/^\s*ExceptionsList\s*:/.test(line)) { inExceptions = true; continue }
    if (inExceptions && /^\s*}\s*$/.test(line)) { inExceptions = false; continue }
    const match = line.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/)
    if (!match) continue
    if (inExceptions && /^\d+$/.test(match[1])) exceptions.push(match[2])
    else scalar.set(match[1], match[2])
  }
  const endpoint = (prefix: 'HTTP' | 'HTTPS'): string | undefined => {
    if (scalar.get(`${prefix}Enable`) !== '1') return undefined
    const host = scalar.get(`${prefix}Proxy`)
    const port = scalar.get(`${prefix}Port`)
    if (!host || !port) return undefined
    const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
    return `http://${formattedHost}:${port}`
  }
  const httpProxy = endpoint('HTTP')
  const httpsProxy = endpoint('HTTPS')
  let warning: string | undefined
  if (!httpProxy && !httpsProxy) {
    if (scalar.get('SOCKSEnable') === '1') warning = 'The macOS system proxy only exposes SOCKS; HTTP/HTTPS proxying is not available.'
    else if (scalar.get('ProxyAutoConfigEnable') === '1') warning = 'PAC system proxies are not supported; set an HTTP/HTTPS proxy manually.'
  }
  return {
    ...(httpProxy ? { httpProxy } : {}),
    ...(httpsProxy ? { httpsProxy } : {}),
    ...(exceptions.length ? { noProxy: exceptions.filter(value => value !== '<local>').join(',') } : {}),
    ...(warning ? { warning } : {}),
  }
}

export function readMacosSystemProxy(platform = process.platform): MacProxyConfig {
  if (platform !== 'darwin') return {}
  try {
    return parseMacosSystemProxy(execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 2_000 }))
  } catch {
    return { warning: 'Could not read the macOS system proxy configuration.' }
  }
}

export function resolveProxy(settings: ProxySettings, env: NodeJS.ProcessEnv = process.env, system = readMacosSystemProxy()): ResolvedProxy {
  if (settings.mode === 'off') return { mode: 'off', source: 'direct' }
  const noProxy = first(env, 'NO_PROXY', 'no_proxy')
  if (settings.mode === 'manual') {
    if (!settings.proxyUrl) throw new Error('Enter a proxy URL before enabling manual proxy mode.')
    const proxy = validateProxyUrl(settings.proxyUrl)
    return { mode: 'manual', source: 'manual', httpProxy: proxy, httpsProxy: proxy, ...(noProxy ? { noProxy } : {}) }
  }
  const loopProxy = first(env, 'LOOPWITHAI_PROXY')
  if (loopProxy) {
    try {
      const proxy = validateProxyUrl(loopProxy)
      return { mode: 'auto', source: 'loopwithai-env', httpProxy: proxy, httpsProxy: proxy, ...(noProxy ? { noProxy } : {}) }
    } catch {
      system = { ...system, warning: 'Ignoring unsupported LOOPWITHAI_PROXY; only HTTP/HTTPS proxy URLs are supported.' }
    }
  }
  const allProxy = first(env, 'ALL_PROXY', 'all_proxy')
  let httpProxy = first(env, 'HTTP_PROXY', 'http_proxy') ?? allProxy
  let httpsProxy = first(env, 'HTTPS_PROXY', 'https_proxy') ?? httpProxy ?? allProxy
  let warning: string | undefined
  for (const [kind, value] of [['HTTP', httpProxy], ['HTTPS', httpsProxy]] as const) {
    if (!value) continue
    try { validateProxyUrl(value) } catch {
      if (kind === 'HTTP') httpProxy = undefined
      else httpsProxy = undefined
      warning = `Ignoring unsupported ${kind}_PROXY; only HTTP/HTTPS proxy URLs are supported.`
    }
  }
  if (httpProxy || httpsProxy) {
    return { mode: 'auto', source: 'environment', ...(httpProxy ? { httpProxy } : {}), ...(httpsProxy ? { httpsProxy } : {}), ...(noProxy ? { noProxy } : {}), ...(warning ? { warning } : {}) }
  }
  return {
    mode: 'auto', source: system.httpProxy || system.httpsProxy ? 'macos-system' : 'direct',
    ...system,
    ...(noProxy ? { noProxy } : {}),
    ...(warning && !system.warning ? { warning } : {}),
  }
}

export function proxyChildEnv(resolved: ResolvedProxy, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) if (value !== undefined && !PROXY_KEYS.includes(key as typeof PROXY_KEYS[number])) env[key] = value
  if (resolved.mode !== 'off') {
    if (resolved.httpProxy) env.HTTP_PROXY = env.http_proxy = resolved.httpProxy
    if (resolved.httpsProxy) env.HTTPS_PROXY = env.https_proxy = resolved.httpsProxy
    if (resolved.noProxy) env.NO_PROXY = env.no_proxy = resolved.noProxy
  }
  return env
}

function sameResolved(left: ResolvedProxy, right: ResolvedProxy): boolean {
  return left.mode === right.mode && left.source === right.source && left.httpProxy === right.httpProxy
    && left.httpsProxy === right.httpsProxy && left.noProxy === right.noProxy && left.warning === right.warning
}

export function createProxyDispatcher(resolved: ResolvedProxy): Dispatcher {
  return resolved.mode === 'off' || (!resolved.httpProxy && !resolved.httpsProxy)
    ? new UndiciAgent({ allowH2: false })
    : new EnvHttpProxyAgent({
      httpProxy: resolved.httpProxy,
      httpsProxy: resolved.httpsProxy,
      noProxy: resolved.noProxy,
      allowH2: false,
    })
}

declare module '@deepseek-ai/cordis' {
  interface Context { networkProxy: NetworkProxy }
}

export class NetworkProxy extends Service {
  static inject = ['settings', 'webServer']
  static Config = z.object({})

  private readonly originalFetch = globalThis.fetch
  private readonly originalDispatcher = getGlobalDispatcher()
  private readonly dispatchers = new Set<Dispatcher>()
  private readonly listeners = new Set<(state: ProxyState) => void>()
  private readonly scope: SettingsScope<ProxySettings>
  private resolved: ResolvedProxy

  constructor(ctx: Context) {
    super(ctx, 'networkProxy')
    this.scope = ctx.settings.register(NS, ProxySettingsSchema, {
      applies: 'live',
      validate: value => { if (value.mode === 'manual') validateProxyUrl(value.proxyUrl ?? '') },
    })
    this.resolved = resolveProxy(this.scope.get())
    this.apply(this.resolved)
    this.scope.watch(next => this.refresh(next))
    this.installWebApi()
    const timer = setInterval(() => {
      if (this.scope.get().mode === 'auto') this.refresh(this.scope.get())
    }, 5_000)
    timer.unref()
    ctx.effect(() => async () => {
      clearInterval(timer)
      globalThis.fetch = this.originalFetch
      setGlobalDispatcher(this.originalDispatcher)
      await Promise.allSettled([...this.dispatchers].map(dispatcher => dispatcher.close()))
    }, 'networkProxy.lifecycle()')
  }

  getState(): ProxyState {
    const descriptor = this.ctx.settings.describe({ redactSecrets: true }).find(value => value.ns === NS)
    return {
      mode: this.resolved.mode,
      source: this.resolved.source,
      ...(this.resolved.httpProxy ? { httpProxy: redactProxyUrl(this.resolved.httpProxy) } : {}),
      ...(this.resolved.httpsProxy ? { httpsProxy: redactProxyUrl(this.resolved.httpsProxy) } : {}),
      ...(this.resolved.noProxy ? { noProxy: this.resolved.noProxy } : {}),
      manualConfigured: Boolean(descriptor?.secrets?.some(secret => secret.path.join('.') === 'proxyUrl' && secret.set)),
      revision: descriptor?.revision ?? 0,
      ...(this.resolved.warning ? { warning: this.resolved.warning } : {}),
    }
  }

  watch(listener: (state: ProxyState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  childEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
    return proxyChildEnv(this.resolved, base)
  }

  async update(input: { mode: ProxyMode; proxyUrl?: string; expectedRevision?: number }): Promise<ProxyState> {
    const patch: Record<string, unknown> = { mode: input.mode }
    if (input.proxyUrl?.trim()) patch.proxyUrl = validateProxyUrl(input.proxyUrl)
    await this.ctx.settings.update(NS, patch, input.expectedRevision)
    this.refresh(this.scope.get())
    return this.getState()
  }

  async testConnection(): Promise<{ reachable: true; status: number; durationMs: number }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('Proxy connection test timed out.')), 8_000)
    const started = performance.now()
    try {
      const response = await globalThis.fetch(TEST_URL, { method: 'GET', signal: controller.signal })
      await response.body?.cancel()
      return { reachable: true, status: response.status, durationMs: Math.round(performance.now() - started) }
    } finally { clearTimeout(timer) }
  }

  private refresh(settings: ProxySettings): void {
    const next = resolveProxy(settings)
    if (sameResolved(next, this.resolved)) return
    this.resolved = next
    this.apply(next)
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }

  private apply(resolved: ResolvedProxy): void {
    const dispatcher = createProxyDispatcher(resolved)
    this.dispatchers.add(dispatcher)
    setGlobalDispatcher(dispatcher)
    globalThis.fetch = undiciFetch as unknown as typeof globalThis.fetch
  }

  private installWebApi(): void {
    const send = (res: import('node:http').ServerResponse, status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact', path: '/api/loopwithai/proxy', handler: async (req, res) => {
        try {
          if (req.method === 'GET') { send(res, 200, this.getState()); return }
          if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return }
          if (req.headers['sec-fetch-site'] === 'cross-site') { send(res, 403, { error: 'cross-site request rejected' }); return }
          if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
            send(res, 415, { error: 'content type must be application/json' }); return
          }
          let body = ''
          for await (const chunk of req) {
            body += String(chunk)
            if (body.length > 16_384) { send(res, 413, { error: 'request too large' }); return }
          }
          const input = JSON.parse(body) as { action?: unknown; mode?: unknown; proxyUrl?: unknown; expectedRevision?: unknown }
          if (input.action === 'test') { send(res, 200, await this.testConnection()); return }
          if (input.action !== 'update' || !['auto', 'manual', 'off'].includes(String(input.mode))) {
            send(res, 400, { error: 'invalid proxy action or mode' }); return
          }
          send(res, 200, await this.update({
            mode: input.mode as ProxyMode,
            ...(typeof input.proxyUrl === 'string' ? { proxyUrl: input.proxyUrl } : {}),
            ...(typeof input.expectedRevision === 'number' ? { expectedRevision: input.expectedRevision } : {}),
          }))
        } catch (error) {
          const conflict = error !== null && typeof error === 'object' && 'code' in error && error.code === 'SETTINGS_CONFLICT'
          send(res, conflict ? 409 : 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'networkProxy.webApi()')
  }
}

export default NetworkProxy
