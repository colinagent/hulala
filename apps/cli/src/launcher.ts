import { randomBytes, timingSafeEqual } from 'node:crypto'
import { request as requestHttp } from 'node:http'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'

import { getAutostartStatus, installAutostart, type AutostartStatus, uninstallAutostart } from './autostart.js'
import { APP_AUTHORITY, APP_HOST, APP_NAME, APP_PORT, APP_URL, HEALTH_URL, VERSION, WORKBENCH_PORT } from './constants.js'
import { recoveryPage } from './recovery-page.js'
import { checkForUpdate, type UpdateStatus } from './update.js'
import { WorkbenchController } from './workbench.js'
import { launcherStateIdentity } from './paths.js'
import { installationIdentity, prepareWorkbenchStop } from './lifecycle.js'

const launcherStartedAt = new Date().toISOString()
const localAuthorities = new Set([APP_AUTHORITY, new URL(HEALTH_URL).host])

/** Keep both browser and command-line traffic on this launcher's local origins. */
export function authorizeLocalRequest(request: IncomingMessage): string | undefined {
  const host = request.headers.host
  if (host === undefined || !localAuthorities.has(host)) return 'host rejected'
  if (request.headers['sec-fetch-site'] === 'cross-site') return 'cross-site request rejected'
  const origin = request.headers.origin
  if (origin !== undefined && origin !== `http://${host}`) return 'origin rejected'
  return undefined
}

function sendJson(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of request) {
    body += String(chunk)
    if (body.length > 16_384) throw new Error('request too large')
  }
  const parsed = JSON.parse(body) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object required')
  return parsed as Record<string, unknown>
}

export function authorizeServiceAction(request: IncomingMessage, actionToken: string): string | undefined {
  const requestError = authorizeLocalRequest(request)
  if (requestError !== undefined) return requestError
  if (request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return 'content type must be application/json'
  }
  const supplied = request.headers['x-hulala-token']
  if (typeof supplied !== 'string') return 'action token required'
  const expectedBytes = Buffer.from(actionToken)
  const suppliedBytes = Buffer.from(supplied)
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) return 'invalid action token'
  return undefined
}

export function proxyRequest(request: IncomingMessage, response: ServerResponse, target = { host: APP_HOST, port: WORKBENCH_PORT }): void {
  const upstream = requestHttp({
    ...target,
    method: request.method,
    path: request.url,
    headers: request.headers,
  }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  request.once('aborted', () => upstream.destroy())
  response.once('close', () => { if (!response.writableEnded) upstream.destroy() })
  upstream.on('error', error => {
    if (response.destroyed) return
    if (!response.headersSent) sendJson(response, 502, { error: `Workbench connection failed: ${error.message}` })
    else response.destroy(error)
  })
  request.pipe(upstream)
}

function proxyUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
  const upstream = connect(WORKBENCH_PORT, APP_HOST)
  upstream.once('connect', () => {
    let raw = `${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/${request.httpVersion}\r\n`
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      raw += `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}\r\n`
    }
    upstream.write(`${raw}\r\n`)
    if (head.length > 0) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  upstream.once('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'))
  socket.once('error', () => upstream.destroy())
}

export async function runLauncher(options: { onReady?: () => void } = {}): Promise<number> {
  const stateId = await launcherStateIdentity()
  const installationId = await installationIdentity()
  const controller = new WorkbenchController()
  const actionToken = randomBytes(32).toString('base64url')
  let cachedAutostart: AutostartStatus | undefined
  let autostartCheckedAt = 0
  let cachedUpdate: UpdateStatus | undefined
  let updateCheckedAt = 0
  let requestShutdown: (() => void) | undefined
  const autostartStatus = async (force = false): Promise<AutostartStatus> => {
    if (force || cachedAutostart === undefined || Date.now() - autostartCheckedAt > 5_000) {
      cachedAutostart = await getAutostartStatus()
      autostartCheckedAt = Date.now()
    }
    return cachedAutostart
  }
  const updateStatus = async (force = false): Promise<UpdateStatus> => {
    if (force || cachedUpdate === undefined || Date.now() - updateCheckedAt > 60 * 60_000) {
      cachedUpdate = await checkForUpdate()
      updateCheckedAt = Date.now()
    }
    return cachedUpdate
  }
  const status = async () => ({
    launcher: {
      state: 'running',
      pid: process.pid,
      version: VERSION,
      startedAt: launcherStartedAt,
      uptimeMs: Math.max(0, Date.now() - Date.parse(launcherStartedAt)),
    },
    workbench: controller.status(),
    autostart: await autostartStatus(),
    update: cachedUpdate ?? { currentVersion: VERSION, available: false },
    localUrl: APP_URL,
    actionToken,
    protocol: 1,
  })

  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', APP_URL).pathname
      const requestError = authorizeLocalRequest(request)
      if (requestError !== undefined) {
        sendJson(response, 403, { error: requestError })
        return
      }
      if (path === '/api/hulala/health') {
        if (request.method !== 'GET' && request.method !== 'HEAD') { sendJson(response, 405, { error: 'method not allowed' }); return }
        const payload = {
          name: APP_NAME,
          stateId,
          installationId,
          protocol: 1,
          version: VERSION,
          pid: process.pid,
          startedAt: launcherStartedAt,
          workbench: controller.status(),
        }
        if (request.method === 'HEAD') {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          response.end()
        } else sendJson(response, 200, payload)
        return
      }
      if (path === '/api/hulala/service') {
        if (request.method === 'GET') { sendJson(response, 200, await status()); return }
        if (request.method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return }
        const authorizationError = authorizeServiceAction(request, actionToken)
        if (authorizationError !== undefined) { sendJson(response, 403, { error: authorizationError }); return }
        try {
          const body = await readJson(request)
          if (['stop', 'restart', 'shutdown'].includes(String(body.action)) && controller.isAvailable()) await prepareWorkbenchStop(body.force === true)
          if (body.action === 'start') await controller.start()
          else if (body.action === 'stop') await controller.stop()
          else if (body.action === 'restart') await controller.restart()
          else if (body.action === 'shutdown') { sendJson(response, 200, { stopping: true }); setTimeout(() => requestShutdown?.(), 10).unref(); return }
          else if (body.action === 'autostart-install') { cachedAutostart = await installAutostart(); autostartCheckedAt = Date.now() }
          else if (body.action === 'autostart-uninstall') { cachedAutostart = await uninstallAutostart(); autostartCheckedAt = Date.now() }
          else if (body.action === 'check-update') { cachedUpdate = await updateStatus(true); updateCheckedAt = Date.now() }
          else { sendJson(response, 400, { error: 'unsupported service action' }); return }
          sendJson(response, 200, await status())
        } catch (error) {
          sendJson(response, 409, { error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (!controller.isAvailable()) {
        if (request.method === 'GET' && (path === '/' || request.headers.accept?.includes('text/html'))) {
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
            'x-content-type-options': 'nosniff',
          })
          response.end(recoveryPage())
        } else sendJson(response, 503, { error: `Workbench is ${controller.status().state}` })
        return
      }
      proxyRequest(request, response)
    })().catch(error => sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }))
  })

  server.on('upgrade', (request, socket, head) => {
    if (authorizeLocalRequest(request) !== undefined) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    if (!controller.isAvailable()) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return }
    proxyUpgrade(request, socket, head)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(APP_PORT, APP_HOST, resolve)
  })
  void controller.start().then(() => options.onReady?.()).catch(error => console.error(`Workbench failed to start: ${error instanceof Error ? error.message : String(error)}`))
  console.log(`Hulala launcher: ${APP_URL}`)

  return await new Promise<number>(resolve => {
    let closing = false
    const shutdown = (code: number): void => {
      if (closing) return
      closing = true
      void controller.stop().finally(() => {
        server.close(() => resolve(code))
        server.closeAllConnections()
      })
    }
    requestShutdown = () => shutdown(0)
    process.once('SIGINT', () => shutdown(130))
    process.once('SIGTERM', () => shutdown(143))
  })
}
