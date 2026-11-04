/**
 * Network helpers for the release index and the archive download.
 *
 * The client runs on Node, and Node's `fetch` ignores the `http_proxy` /
 * `https_proxy` environment variables. On a machine that can only reach the
 * internet through a local proxy — the common setup here — every update then
 * fails with a bare timeout, which looks like "the server is slow" instead of
 * "the proxy was bypassed". `curl` honours those variables (and `ALL_PROXY`),
 * so when a proxy is configured the transfer goes through it instead.
 *
 * Bun's `fetch` does honour the variables, so this only applies under Node.
 *
 * @module @hulala/distribution/net
 */
import { spawn, spawnSync } from 'node:child_process'
import { stat } from 'node:fs/promises'

/** Environment holding a proxy this process must use, if any. */
export function proxyConfigured(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY']) {
    const value = env[key]?.trim()
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

/**
 * Whether transfers have to leave through `curl` rather than `fetch`.
 * @param env - injected environment, for tests.
 * @returns true under Node with a proxy configured and `curl` available.
 */
export function useCurl(env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof Bun !== 'undefined') return false
  if (proxyConfigured(env) === undefined) return false
  return spawnSync('curl', ['--version'], { stdio: 'ignore' }).status === 0
}

/**
 * Read a small URL (the release index) through `curl`.
 * @param url - HTTPS URL.
 * @param timeoutSeconds - hard limit for the request.
 * @returns the response body.
 */
export async function curlText(url: string, timeoutSeconds = 30): Promise<string> {
  const child = spawn('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', String(timeoutSeconds), url], { stdio: ['ignore', 'pipe', 'pipe'] })
  let body = ''
  let error = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { body += chunk })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { error += chunk })
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  if (code !== 0) throw new Error(`curl failed (${code}): ${error.trim() || url}`)
  return body
}

export interface CurlFileOptions {
  /** Seconds without progress before curl gives up; the partial file is kept. */
  readonly stallSeconds?: number
  readonly signal?: AbortSignal
  readonly onProgress?: (received: number, total: number | undefined) => void
}

/**
 * Download a file through `curl`, resuming a previous partial file.
 *
 * `--continue-at -` makes curl ask for the rest of `.part`, and
 * `--speed-limit/--speed-time` is the stall window (curl's equivalent of the
 * fetch path's timer). The caller verifies the digest afterwards.
 * @param url - HTTPS URL.
 * @param destination - final path; the transfer writes `<destination>.part`.
 * @param options - stall window, abort signal and progress.
 */
export async function curlFile(url: string, destination: string, options: CurlFileOptions = {}): Promise<void> {
  const stall = options.stallSeconds ?? 90
  const part = `${destination}.part`
  const child = spawn('curl', [
    '--fail', '--show-error', '--location', '--continue-at', '-',
    '--speed-limit', '32768', '--speed-time', String(stall),
    '--output', part, '--url', url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let error = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => { error += chunk })
  const abort = (): void => { child.kill('SIGTERM') }
  options.signal?.addEventListener('abort', abort, { once: true })
  const ticker = options.onProgress === undefined ? undefined : setInterval(() => {
    stat(part).then(entry => options.onProgress?.(entry.size, undefined)).catch(() => undefined)
  }, 500)
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', resolve)
    })
    if (code !== 0) throw new Error(`curl failed (${code}): ${error.trim() || url}`)
  } finally {
    options.signal?.removeEventListener('abort', abort)
    if (ticker !== undefined) clearInterval(ticker)
  }
}
