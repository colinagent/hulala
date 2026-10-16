import { mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'
import WebSocket from 'ws'
import { resolveHulalaPaths } from '@hulala/workbench-contracts/paths'
import { createBrowserWorkspaceSchema, openWorkspaceSchema, nativeDirectoryDialogSchema, type BrowserBootstrap } from '@hulala/workbench-contracts/browser'
import { BrowserWorkspaceRegistry } from './registry'
import { WorkspaceWorkers, type WorkerOptions, type WorkspaceTransport } from './workers'
import { superviseScheduledWorkspaces } from './background'
import { BrowserSettings } from './settings'
import { BrowserRecovery } from './recovery'
import { PdfExports, pdfInput, pdfLayout } from './pdf'
import { browserAuthenticated, browserCookie, browserRequestError } from './security'
import { createConnectionToken } from '../auth'
import { ensureDefaultWorkspace } from '../defaultWorkspace'
import { HttpError, json, parseJson, errorResponse } from '../http'
import { connectSshSchema, saveSshHostSchema, trustSshSchema } from '@hulala/workbench-contracts/ssh'
import { SshHosts, type SecretStore } from '../ssh/hosts'
import { SshTrust } from '../ssh/connection'
import { SshPackages } from '../ssh/install'
import { RemoteWorkspaceWorkers } from '../ssh/workers'
import { SleepPrevention } from './power'
import type { SettingsState } from '../settings/settingsStore'
import { BrowserLifecycle } from './lifecycle'
import { ensureBrowserDataFormat } from './data-format'
import { browserServiceInfo } from './installation'
import { NativeDirectoryPicker } from './native-directory'

export interface BrowserServerOptions extends WorkerOptions {
  port: number
  publicPort: number
  webDirectory: string
  settingsDirectory: string
  remotePackagesDirectory?: string
  sshHome?: string
  sshSecrets?: SecretStore
}
type SocketData = { worker: WorkspaceTransport; workspaceId: string; viewId?: string; releaseView?: () => void; upstream?: WebSocket }
const pathInput = z.object({ path: z.string().min(1).max(32768) }).strict()

export async function startBrowserServer(options: BrowserServerOptions) {
  const paths = resolveHulalaPaths(options.hulalaRoot, options.workspaceRoot)
  await ensureBrowserDataFormat(paths.root)
  const settings = new BrowserSettings(paths.root, options.settingsDirectory)
  await settings.initialize()
  await mkdir(paths.workspace, { recursive: true, mode: 0o700 })
  await ensureDefaultWorkspace(paths.workspace)
  const registry = new BrowserWorkspaceRegistry(join(paths.server, 'browser/workspaces.json'), paths.workspaceRoot)
  await registry.load()
  const preference = await settings.get()
  let notifySettings = () => {}
  const power = new SleepPrevention(process.platform, undefined, () => notifySettings())
  const keepAwake = (value: SettingsState) => value.system.power?.idleSleepPolicy === 'whileAppRunning'
  let settingsUpdates: Promise<unknown> = Promise.resolve()
  const getSettings = async () => { await settingsUpdates; return { ...await settings.get(), browserPower: power.snapshot() } }
  const setSettings = (patch: Partial<SettingsState>) => {
    const next = settingsUpdates.then(async () => {
      const previous = await settings.get()
      const requested = patch.system?.power?.idleSleepPolicy
      try {
        if (requested !== undefined) await power.apply(requested === 'whileAppRunning')
        await settings.set(patch)
        notifySettings()
        return { ...await settings.get(), browserPower: power.snapshot() }
      } catch (error) { await power.apply(keepAwake(previous)).catch(() => undefined); throw new HttpError(409, 'settings_not_saved', error instanceof Error ? error.message : 'Settings could not be saved') }
    })
    settingsUpdates = next.catch(() => undefined)
    return next
  }
  const initialPath = preference.user.defaultWorkspacePath || paths.workspace
  const initial = await registry.open(initialPath)
  const workers = new WorkspaceWorkers(options)
  const sshHosts = new SshHosts(paths.root, options.sshSecrets, options.sshHome)
  const sshTrust = new SshTrust(paths.root)
  await Promise.all([sshHosts.load(), sshTrust.load()])
  const remoteWorkers = new RemoteWorkspaceWorkers(sshHosts, sshTrust, new SshPackages(options.remotePackagesDirectory || process.env.HULALA_REMOTE_PACKAGES || join(options.repositoryRoot, 'dist/remote'), options.runtimeHostModule ? options.repositoryRoot : undefined, { root: paths.root, version: options.version }), options.version)
  const recovery = new BrowserRecovery(join(paths.server, 'browser/drafts'))
  const pdf = new PdfExports(join(paths.cache, 'exports'))
  const directoryPicker = new NativeDirectoryPicker(paths.workspace)
  const webRoot = await realpath(options.webDirectory)
  if (!(await stat(join(webRoot, 'index.html'))).isFile()) throw new Error('Build the browser workbench before starting it')
  await workers.get(initial)
  await power.apply(keepAwake(preference)).catch(() => undefined)
  const token = createConnectionToken()
  const cookieName = 'hulala_browser_' + options.publicPort
  const authorities = new Set<string>()
  const backgroundStatus = { starting: true, failed: [] as Array<{ id: string; name: string }> }
  let stopping = false
  const lifecycle = new BrowserLifecycle(workers, recovery, () => registry.list().map(workspace => workspace.id), () => background)
  let server: Bun.Server<SocketData>
  try { server = Bun.serve<SocketData>({
    hostname: '127.0.0.1', port: options.port, maxRequestBodySize: 256 * 1024 * 1024,
    async fetch(request, server) {
      const url = new URL(request.url)
      let releaseMutation: (() => void) | undefined
      try {
        const failure = browserRequestError(request, authorities)
        if (failure) throw new HttpError(403, 'request_forbidden', failure)
        if (url.pathname === '/api/hulala/health' && request.method === 'GET') {
          return json({ name: 'hulala', protocol: 1, version: options.version, pid: process.pid, startedAt, workbench: { state: stopping ? 'stopping' : 'running' } })
        }
        if (stopping) throw new HttpError(503, 'service_stopping', 'The local service is stopping')
        if (url.pathname.startsWith('/api/')) {
          if (!browserAuthenticated(request, cookieName, token)) throw new HttpError(401, 'browser_session_required', 'Reload the Hulala page to reconnect')
          if (request.headers.has('x-hulala-protocol') && request.headers.get('x-hulala-protocol') !== '1') throw new HttpError(409, 'protocol_mismatch', 'This page uses a different Hulala protocol. Save or export drafts and reload the page.')
          if (url.pathname === '/api/browser/lifecycle') {
            if (request.method === 'GET') return json(await lifecycle.summary())
            if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'POST required')
            const input = await parseJson(request, z.object({ action: z.enum(['prepare', 'cancel']), force: z.boolean().optional(), lease: z.string().uuid().optional() }).strict())
            if (input.action === 'prepare') return json(await lifecycle.prepare(input.force === true))
            if (!input.lease) throw new HttpError(400, 'lease_required', 'A restart reservation is required')
            await lifecycle.cancel(input.lease); return json({ resumed: true })
          }
          if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) releaseMutation = lifecycle.enter()
          if (url.pathname === '/api/browser/dialogs/directory' && request.method === 'POST') {
            server.timeout(request, 0)
            return json(await directoryPicker.pick(await parseJson(request, nativeDirectoryDialogSchema), request.signal))
          }
          if (url.pathname === '/api/browser/ssh/hosts') {
            if (request.method === 'GET') { await sshHosts.refreshConfig(); return json(sshHosts.list()) }
            if (request.method === 'POST') return json(await sshHosts.save(await parseJson(request, saveSshHostSchema)), 201)
          }
          const sshHostRoute = url.pathname.match(/^\/api\/browser\/ssh\/hosts\/([a-f0-9-]{36})(\/trust)?$/)
          if (sshHostRoute) {
            const host = sshHosts.get(sshHostRoute[1]!)
            if (sshHostRoute[2] === '/trust' && request.method === 'GET') return json({ challenge: sshTrust.challenge(host.id) || null })
            if (sshHostRoute[2] === '/trust' && request.method === 'POST') { await sshTrust.accept(host, (await parseJson(request, trustSshSchema)).fingerprint); return json({ accepted: true }) }
            if (!sshHostRoute[2] && request.method === 'DELETE') { await sshHosts.remove(host.id); return json({ removed: true }) }
          }
          if (url.pathname === '/api/browser/ssh/identity' && request.method === 'POST') return json({ path: await sshHosts.identity((await parseJson(request, pathInput)).path) })
          if (url.pathname === '/api/browser/ssh/open' && request.method === 'POST') {
            const input = await parseJson(request, connectSshSchema)
            const worker = await remoteWorkers.open(input.hostId, input.path)
            return json(await registry.openRemote(input.hostId, sshHosts.get(input.hostId).alias, worker.path), 201)
          }
          if (url.pathname === '/api/browser/ssh/restart' && request.method === 'POST') {
            const input = await parseJson(request, connectSshSchema.extend({ force: z.boolean().optional() }))
            const worker = await remoteWorkers.restart(input.hostId, input.path, input.force === true)
            return json(await registry.openRemote(input.hostId, sshHosts.get(input.hostId).alias, worker.path), 201)
          }
          if (url.pathname === '/api/browser/ssh/managed' && request.method === 'POST') {
            const input = await parseJson(request, z.object({ hostId: z.uuid(), name: z.string().min(1).max(128) }).strict())
            const worker = await remoteWorkers.createManaged(input.hostId, input.name)
            return json(await registry.openRemote(input.hostId, sshHosts.get(input.hostId).alias, worker.path), 201)
          }
          if ((url.pathname === '/api/browser/ssh/directories' || url.pathname === '/api/browser/ssh/directories/stat') && request.method === 'GET') {
            const input = z.object({ hostId: z.uuid(), path: z.string().min(1).max(32768).optional() }).parse({ hostId: url.searchParams.get('hostId'), path: url.searchParams.get('path') || undefined })
            return json(await remoteWorkers.directory(input.hostId, input.path, url.pathname.endsWith('/stat')))
          }
          if (url.pathname === '/api/browser/workspaces') {
            if (request.method === 'GET') return json({ items: registry.list() })
            if (request.method === 'POST') return json(await registry.open((await parseJson(request, openWorkspaceSchema)).path), 201)
          }
          if (url.pathname === '/api/browser/background' && request.method === 'GET') return json(backgroundStatus)
          if (url.pathname === '/api/browser/workspaces/managed' && request.method === 'POST') {
            return json(await registry.create((await parseJson(request, createBrowserWorkspaceSchema)).name), 201)
          }
          if (url.pathname === '/api/browser/settings') {
            if (request.method === 'GET') return json(await getSettings())
            if (request.method === 'PATCH') return json(await setSettings(await parseJson(request, z.record(z.string(), z.unknown()))))
          }
          if (url.pathname === '/api/browser/directories/special' && request.method === 'GET') {
            return json([
              { key: 'workspace', label: 'Workspace', path: paths.workspace },
              { key: 'home', label: 'Home', path: homedir() },
              { key: 'root', label: 'Root', path: resolve(paths.workspace, '/') },
            ])
          }
          if (url.pathname === '/api/browser/directories' || url.pathname === '/api/browser/directories/stat') {
            if (request.method !== 'GET') throw new HttpError(405, 'method_not_allowed', 'GET required')
            const target = url.searchParams.get('path') || paths.workspace
            if (!isAbsolute(target) || target.includes('\0')) throw new HttpError(400, 'path_invalid', 'An absolute directory is required')
            const canonical = await realpath(target)
            const info = await stat(canonical)
            if (url.pathname.endsWith('/stat')) return json({ path: canonical, name: basename(canonical), size: info.size, isDir: info.isDirectory(), modTime: info.mtimeMs })
            const entries = await readdir(canonical, { withFileTypes: true })
            return json({ path: canonical, entries: await Promise.all(entries.slice(0, 10000).map(async entry => {
              const metadata = await stat(join(canonical, entry.name)).catch(() => null)
              return { name: entry.name, isDir: metadata?.isDirectory() ?? false, size: metadata?.size ?? 0, modTime: metadata?.mtimeMs ?? 0 }
            })) })
          }
          if (url.pathname === '/api/browser/directories/mkdir' && request.method === 'POST') {
            const { path } = await parseJson(request, pathInput)
            if (!isAbsolute(path) || path.includes('\0')) throw new HttpError(400, 'path_invalid', 'An absolute path is required')
            await mkdir(path, { recursive: true, mode: 0o700 })
            return json({ success: true })
          }
          const route = url.pathname.match(/^\/api\/browser\/workspaces\/([a-f0-9-]{36})(\/.*)?$/)
          if (route) {
            const workspace = registry.get(route[1]!)
            if (route[2]?.startsWith('/drafts') || route[2] === '/views') return await recovery.request(workspace.id, route[2], request)
            const worker = workspace.kind === 'remote' ? (route[2] === '/bootstrap' ? await remoteWorkers.open(workspace.hostId!, workspace.path) : await remoteWorkers.get(workspace)) : await workers.get(workspace)
            const suffix = route[2] || '/bootstrap'
            if (suffix === '/exports' && request.method === 'POST') {
              return json(await pdf.export(workspace.id, worker, await parseJson(request, pdfInput, 20 * 1024 * 1024), `http://127.0.0.1:${server.port}`, request.signal))
            }
            const exportRoute = suffix.match(/^\/exports\/([a-f0-9-]{36})(\/ready|\/error)?$/)
            if (exportRoute) {
              const job = pdf.get(workspace.id, exportRoute[1]!)
              if (!exportRoute[2] && request.method === 'GET') return json(job.payload)
              if (exportRoute[2] === '/ready' && request.method === 'POST') { job.ready(await parseJson(request, pdfLayout)); return json({ ready: true }) }
              if (exportRoute[2] === '/error' && request.method === 'POST') { job.fail(new Error((await parseJson(request, z.object({ message: z.string().max(8192) }))).message)); return json({ received: true }) }
            }
            if (suffix === '/bootstrap' && request.method === 'GET') {
              backgroundStatus.failed = backgroundStatus.failed.filter(item => item.id !== workspace.id)
              const bootstrap: BrowserBootstrap = { workspace, nativeWorkspace: worker.workspace, instanceId: worker.descriptor.instanceId, protocol: 1, service: browserServiceInfo(options.version), version: options.version, platform: process.platform, homeDir: homedir(), defaultDir: paths.workspace, settingsRoot: paths.config }
              if ('remote' in worker && workspace.hostId) {
                bootstrap.remote = worker.remote
                const host = sshHosts.get(workspace.hostId)
                bootstrap.remoteHost = { id: host.id, alias: host.alias, hostname: host.hostname, user: host.user, port: String(host.port), authMethod: host.authMethod, source: host.source }
              }
              return json(bootstrap)
            }
            if (suffix === '/events' && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
              const viewId = url.searchParams.get('viewId') || undefined
              if (viewId && !z.string().uuid().safeParse(viewId).success) throw new HttpError(400, 'view_invalid', 'Invalid view identity')
              return server.upgrade(request, { data: { worker, workspaceId: workspace.id, viewId } }) ? undefined : new Response(null, { status: 400 })
            }
            if (suffix.startsWith('/api/')) {
              const pathname = suffix.slice(4)
              if (pathname === '/workspaces' || pathname.startsWith('/workspaces/') || pathname === '/lifecycle') throw new HttpError(403, 'workspace_scope', 'Workspace registration and lifecycle belong to the browser service')
              const response = await worker.request(pathname + url.search, {
                method: request.method,
                headers: new Headers([...request.headers].filter(([name]) => ['content-type', 'content-length', 'range', 'if-match', 'if-none-match'].includes(name))),
                ...(request.method !== 'GET' && request.method !== 'HEAD' ? { body: request.body } : {}),
                signal: request.signal,
              })
              const headers = new Headers(response.headers)
              headers.delete('set-cookie')
              headers.set('cache-control', 'no-store')
              headers.set('x-content-type-options', 'nosniff')
              if (pathname.startsWith('/resources/') && !pathname.startsWith('/resources/import')) {
                headers.set('content-security-policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:")
              }
              return new Response(response.body, { status: response.status, headers })
            }
          }
          throw new HttpError(404, 'route_not_found', 'Route not found')
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'GET required')
        if (url.pathname === '/') {
          return new Response(null, { status: 302, headers: { location: '/w/' + initial.id, 'set-cookie': browserCookie(cookieName, token), 'cache-control': 'no-store' } })
        }
        const isWorkspacePage = /^\/w\/[a-f0-9-]{36}$/.test(url.pathname)
        const isPage = isWorkspacePage || url.pathname === '/open'
        if (isWorkspacePage) registry.get(url.pathname.split('/')[2]!)
        const filePath = resolve(webRoot, '.' + (isPage ? '/index.html' : decodeURIComponent(url.pathname)))
        const resolved = await realpath(filePath)
        const local = relative(webRoot, resolved)
        if (local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) throw new HttpError(403, 'asset_forbidden', 'Asset path is outside the workbench')
        const file = Bun.file(resolved)
        const headers = new Headers({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': isPage ? 'no-store' : 'public, max-age=3600', 'content-security-policy': `frame-ancestors ${isPage ? "'none'" : "'self'"}; object-src 'none'; base-uri 'none'` })
        if (isPage) headers.set('set-cookie', browserCookie(cookieName, token))
        return new Response(request.method === 'HEAD' ? null : file, { headers })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return json({ code: 'not_found', message: 'File or directory not found' }, 404)
        return errorResponse(error)
      } finally { releaseMutation?.() }
    },
    websocket: {
      backpressureLimit: 8 * 1024 * 1024,
      closeOnBackpressureLimit: true,
      maxPayloadLength: 1024,
      open(socket) {
        socket.subscribe('browser.settings')
        if (socket.data.viewId) socket.data.releaseView = recovery.connectView(socket.data.workspaceId, socket.data.viewId)
        const { descriptor } = socket.data.worker
        const upstream = new WebSocket(descriptor.eventsUrl, { headers: { origin: descriptor.httpUrl, 'x-hulala-token': descriptor.token } })
        socket.data.upstream = upstream
        upstream.once('open', () => socket.send(JSON.stringify({ type: 'browser.connected' })))
        upstream.on('message', data => {
          const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
          if (bytes.length > 8 * 1024 * 1024) socket.close(1009)
          else socket.send(bytes.toString())
        })
        upstream.on('close', () => socket.close(1012, 'Runtime connection closed'))
        upstream.on('error', () => socket.close(1011, 'Runtime connection failed'))
      },
      message(socket) { socket.close(1008, 'This event stream is read-only') },
      close(socket) { socket.data.releaseView?.(); socket.data.upstream?.close() },
    },
  }) } catch (error) { await Promise.all([workers.stop(), remoteWorkers.stop(), power.stop()]); throw error }
  const startedAt = new Date().toISOString()
  notifySettings = () => { if (!stopping) server.publish('browser.settings', JSON.stringify({ type: 'browser.settingsChanged' })) }
  settings.watch(() => { void settingsUpdates.then(() => settings.get()).then(value => power.apply(keepAwake(value))).catch(() => undefined).finally(notifySettings) })
  for (const port of new Set([server.port, options.publicPort])) for (const host of ['127.0.0.1', 'hulala.localhost', 'localhost']) authorities.add(new URL(`http://${host}:${port}`).host)
  const background = superviseScheduledWorkspaces(workers, () => registry.list(), failures => {
    backgroundStatus.starting = false
    backgroundStatus.failed = failures.map(id => ({ id, name: registry.get(id).name }))
  })
  const viewCheckpoint = setInterval(() => { void recovery.checkpointViews().catch(() => undefined) }, 10000)
  viewCheckpoint.unref()
  return {
    server, registry, workers, backgroundReady: background.ready,
    async stop() { if (stopping) return; stopping = true; lifecycle.stop(); settings.stop(); clearInterval(viewCheckpoint); await directoryPicker.stop(); await recovery.sealViews().catch(() => undefined); server.stop(true); await settingsUpdates; await background.stop(); await Promise.all([workers.stop(), remoteWorkers.stop(), recovery.flush(), pdf.stop(), power.stop()]); sshHosts.stop() },
  }
}
