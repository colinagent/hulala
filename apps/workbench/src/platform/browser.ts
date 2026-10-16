import { sessionStore } from "./storage";
import type { BrowserBootstrap, BrowserWorkspace } from '@hulala/workbench-contracts/browser'
import type { WorkbenchPlatform, SshHostPayload, HarnessRuntimeState } from '../renderer/types/platform'
import { chooseDirectory, configureBrowserSecret } from './dialogs'
import { createBrowserRecovery } from './recovery'
import { uploadBrowserResource } from './upload'
import { browserContext, installBrowserContext } from './contexts'

const encode = encodeURIComponent
type Data = Record<string, any>
const reservedPages = new Map<string, Window | null>()
export class BrowserApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message) }
}

export async function browserJson<T = any>(url: string, init?: RequestInit, reconnect = true): Promise<T> {
  const headers = new Headers(init?.headers); headers.set('x-hulala-protocol', '1')
  const response = await fetch(url, { ...init, headers, credentials: 'same-origin' })
  if (response.status === 401 && reconnect) {
    await fetch(location.pathname, { credentials: 'same-origin', cache: 'no-store' })
    return browserJson<T>(url, init, false)
  }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new BrowserApiError('The local workbench is unavailable. Check the Hulala service.', response.status, 'service_unavailable')
  const result = await response.json() as T & { message?: string; error?: string; code?: string }
  if (!response.ok) throw new BrowserApiError(result.message || result.error || `Request failed (${response.status})`, response.status, result.code || 'request_failed')
  return result
}
const body = (value: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
const presentRuntimeState = (state: HarnessRuntimeState): HarnessRuntimeState => ({ ...state, runtimes: state.runtimes?.map(runtime => runtime.id === 'claude' ? { ...runtime, name: 'Claude Agent' } : runtime) })

export function reserveWorkspacePage(): Window | null {
  const page = window.open('about:blank', '_blank')
  if (page) {
    page.opener = null; page.document.title = 'Opening Workspace · Hulala'
    const status = page.document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'Opening Workspace…'
    page.document.body.append(status)
    page.document.body.style.cssText = 'font: 16px system-ui; padding: 32px; color-scheme: light dark'
  }
  return page
}

export async function openBrowserWorkspace(path: string, reserved?: Window | null, file?: string): Promise<void> {
  const replaceCurrent = location.pathname === '/open'
  const existing = reservedPages.get(path)
  const hadReserved = reservedPages.delete(path)
  const page = replaceCurrent ? window : reserved !== undefined ? reserved : hadReserved ? existing ?? null : reserveWorkspacePage()
  try {
    const workspace = await browserJson<BrowserWorkspace>('/api/browser/workspaces', body({ path }))
    const url = '/w/' + workspace.id + (file ? '?' + new URLSearchParams({ file }) : '')
    if (page) { if (!page.closed) page.location.replace(url) }
    else window.dispatchEvent(new CustomEvent('hulala:open-blocked', { detail: { url, name: workspace.name } }))
  } catch (error) { if (page !== window) page?.close(); throw error }
}

export async function openLocalWorkspaceDirectory(defaultPath?: string): Promise<string | null> {
  // Reserve during the browser click; the system dialog may remain open for minutes.
  const reserved = location.pathname === '/open' ? window : reserveWorkspacePage()
  try {
    const path = await chooseDirectory(defaultPath, { title: 'Open Folder' })
    if (!path) { if (reserved !== window) reserved?.close(); return null }
    await openBrowserWorkspace(path, reserved)
    return path
  } catch (error) { if (reserved !== window) reserved?.close(); throw error }
}

export async function openRemoteWorkspace(host: SshHostPayload, path?: string, createName?: string, document?: { reserved: Window | null; file: string }): Promise<void> {
  if (!host.id) throw new Error('Choose a saved SSH host')
  const page = location.pathname === '/open' ? window : document ? document.reserved : reserveWorkspacePage()
  if (page && page !== window) { const status = page.document.querySelector('[role="status"]'); if (status) status.textContent = 'Connecting to ' + host.alias + '…' }
  try {
    let workspace: BrowserWorkspace
    const open = () => browserJson<BrowserWorkspace>('/api/browser/ssh/' + (createName ? 'managed' : 'open'), body({ hostId: host.id, ...(createName ? { name: createName } : path ? { path } : {}) }))
    let trusted = false
    for (;;) {
      try { workspace = await open(); break }
      catch (error) {
        if (!(error instanceof BrowserApiError)) throw error
        if (error.code === 'ssh_runtime_version' && !createName) {
          if (!window.confirm(error.message + '\nRestart this remote Workspace Host? All views of this folder will reconnect; other folders keep running.')) { if (page !== window) page?.close(); return }
          const restart = (force: boolean) => browserJson<BrowserWorkspace>('/api/browser/ssh/restart', body({ hostId: host.id, ...(path ? { path } : {}), force }))
          try { workspace = await restart(false) }
          catch (reason) {
            if (!(reason instanceof BrowserApiError) || reason.code !== 'ssh_active_work') throw reason
            if (!window.confirm(reason.message + '\nStop this work and restart the remote Workspace?')) { if (page !== window) page?.close(); return }
            workspace = await restart(true)
          }
          break
        }
        if (trusted || !['ssh_host_key_unknown', 'ssh_host_key_changed'].includes(error.code)) throw error
        const { challenge } = await browserJson<{ challenge: { endpoint: string; fingerprint: string; previous?: string } | null }>('/api/browser/ssh/hosts/' + host.id + '/trust')
        if (!challenge) throw error
        const message = (challenge.previous ? 'SSH HOST KEY CHANGED. Verify this change with the host owner before continuing.\nPrevious: ' + challenge.previous + '\n' : 'Connect to this new SSH host only if you recognize its fingerprint.\n')
          + challenge.endpoint + '\n' + challenge.fingerprint + '\nTrust this key and connect?'
        if (!window.confirm(message)) { if (page !== window) page?.close(); return }
        await browserJson('/api/browser/ssh/hosts/' + host.id + '/trust', body({ fingerprint: challenge.fingerprint })); trusted = true
      }
    }
    const url = '/w/' + workspace.id + (document ? '?' + new URLSearchParams({ file: document.file }) : '')
    if (page) { if (!page.closed) page.location.replace(url) }
    else window.dispatchEvent(new CustomEvent('hulala:open-blocked', { detail: { url, name: workspace.name } }))
  } catch (error) { if (page !== window) page?.close(); window.dispatchEvent(new CustomEvent('hulala:notice', { detail: { message: error instanceof Error ? error.message : String(error) } })); throw error }
}

function external(value: string): void {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) links may be opened')
  window.open(url.href, '_blank', 'noopener,noreferrer')
}

function readStored<T>(key: string, fallback: T): T {
  try { const raw = sessionStore.getItem(key); return raw ? JSON.parse(raw) as T : fallback } catch { return fallback }
}

export async function createBrowserPlatform(options: { workspaceId?: string; reference?: boolean } = {}): Promise<WorkbenchPlatform> {
  let id = options.workspaceId || location.pathname.match(/^\/w\/([a-f0-9-]{36})$/)?.[1]
  if (!id) {
    const listed = await browserJson<{ items: BrowserWorkspace[] }>('/api/browser/workspaces')
    id = listed.items[0]?.id
  }
  if (!id) throw new Error('No Workspace is available')
  const prefix = '/api/browser/workspaces/' + id
  let bootstrap = await browserJson<BrowserBootstrap>(prefix + '/bootstrap')
  if (bootstrap.protocol !== 1) throw new BrowserApiError('This page needs a matching Hulala service version. Reload the page after saving your work.', 409, 'protocol_mismatch')
  const loadedVersion = bootstrap.version
  let upgradeNotified = false
  const api = <T = any>(path: string, init?: RequestInit) => browserJson<T>(prefix + '/api' + path, init)
  let workspace = bootstrap.nativeWorkspace
  const workspaceBody = (value: object, method?: string) => body({ workspaceId: workspace.id, ...value }, method)
  const query = new URLSearchParams(location.search)
  const exportJob = query.get('view') === 'markdown-pdf-export' ? query.get('job') : null
  const readonlyExportBackup: WorkbenchPlatform['backup'] = { stage: () => { throw new Error('PDF render views cannot edit drafts') }, load: async () => [], flush: async () => ({}), delete: async () => { throw new Error('PDF render views cannot delete drafts') } }
  const { viewId, backup } = exportJob ? { viewId: crypto.randomUUID(), backup: readonlyExportBackup } : await createBrowserRecovery(id, prefix, browserJson)
  const stateKey = 'hulala.view.' + id
  let saved = readStored<Data | null>(stateKey, null)
  const initialFile = query.get('file')
  if (initialFile && !options.reference && !exportJob) {
    saved = { ...saved, tabs: [{ ...saved?.tabs?.[0], openEditors: [{ path: initialFile, pane: 'main', active: true }], openTools: [] }] }
    query.delete('file')
    history.replaceState(history.state, '', location.pathname + (query.size ? '?' + query : '') + location.hash)
  }
  const connectionListeners = new Set<Parameters<WorkbenchPlatform['desktop']['onConnection']>[0]>()
  const eventListeners = new Set<Parameters<WorkbenchPlatform['desktop']['onEvent']>[0]>()
  const settingsListeners = new Set<Parameters<WorkbenchPlatform['settings']['onChanged']>[0]>()
  const serviceListeners = new Set<Parameters<WorkbenchPlatform['serviceInfo']['onChanged']>[0]>()
  let latestSettings: Data | undefined
  const readSettings = async () => { const value = await browserJson<Data>('/api/browser/settings'); latestSettings = value; return value }
  const sockets = new Map<string, WebSocket>()
  let settingsChannel: BroadcastChannel | null = null
  try { if (!options.reference && typeof BroadcastChannel === 'function') settingsChannel = new BroadcastChannel('hulala.preferences') } catch { /* Host events also synchronize independent browser contexts. */ }
  const refreshSettings = () => { if (!options.reference) void readSettings().then(value => settingsListeners.forEach(handler => handler(value))).catch(() => undefined) }
  settingsChannel?.addEventListener('message', refreshSettings)
  const connection = (tabId: string, state: 'connected' | 'disconnected') => connectionListeners.forEach(handler => handler({ tabId, state }))
  const disconnect = (tabId: string) => { const socket = sockets.get(tabId); sockets.delete(tabId); socket?.close(); connection(tabId, 'disconnected') }
  const scopedQuery = (path: string, value?: string) => `?workspaceId=${encode(workspace.id)}${value === undefined ? '' : '&path=' + encode(value)}`
  const session = (sessionId: string, path = '') => '/conversations/' + encode(sessionId) + path
  const unavailable = async (): Promise<never> => { throw new Error('This native capability is awaiting its browser adaptation.') }
  const openHarnessDocument = async (path: string, payload?: object) => {
    // Reserve during the click, before the Host resolves its native document.
    const reserved = reserveWorkspacePage()
    try {
      const document = await api<{ path: string; directory: string }>(path, payload ? body(payload) : { method: 'POST' })
      if (bootstrap.workspace.kind === 'remote') {
        if (!bootstrap.remoteHost) throw new Error('The SSH host is unavailable')
        await openRemoteWorkspace(bootstrap.remoteHost, document.directory, undefined, { reserved, file: document.path })
      } else await openBrowserWorkspace(document.directory, reserved, document.path)
      return { opened: true }
    } catch (error) { reserved?.close(); throw error }
  }
  const platform: WorkbenchPlatform = {
    kind: 'browser', platform: bootstrap.platform, isDev: false,
    getPath: async name => name === 'home' ? bootstrap.homeDir : name === 'userData' ? bootstrap.settingsRoot : (() => { throw new Error('Unknown system directory') })(),
    getHomeDir: async () => bootstrap.homeDir,
    getDefaultDir: async () => bootstrap.defaultDir,
    localDirectoryPicker: {
      listDirectory: path => browserJson('/api/browser/directories?path=' + encode(path)),
      statPath: path => browserJson('/api/browser/directories/stat?path=' + encode(path)),
      getSpecialDirectories: () => browserJson('/api/browser/directories/special'),
      mkdir: path => browserJson('/api/browser/directories/mkdir', body({ path })),
      writeFile: (path, content) => api('/files/text', workspaceBody({ path, content, expectedVersion: null }, 'PUT')),
    },
    exportMarkdownPdfToPath: async payload => {
      const source = (payload as Data)?.workspaceViewId
      if (source && source !== viewId && browserContext(source)) return browserContext(source)!.platform.exportMarkdownPdfToPath(payload)
      try { return await browserJson(prefix + '/exports', body(payload)) } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    },
    getPdfExportDefaultPath: async payload => {
      if (payload.workspaceViewId && payload.workspaceViewId !== viewId && browserContext(payload.workspaceViewId)) return browserContext(payload.workspaceViewId)!.platform.getPdfExportDefaultPath(payload)
      const path = payload.sourcePath?.replace(/\\/g, '/')
      return { defaultDir: path ? path.slice(0, path.lastIndexOf('/')) : payload.currentDir || workspace.path, defaultFileName: (path?.split('/').pop()?.replace(/\.(md|markdown)$/i, '') || 'Untitled') + '.pdf' }
    },
    pdfExport: {
      getPayload: () => exportJob ? browserJson(prefix + '/exports/' + encode(exportJob)) : Promise.reject(new Error('This page is not an export view')),
      reportReady: layout => { if (exportJob) void browserJson(prefix + '/exports/' + encode(exportJob) + '/ready', body(layout)).catch(() => undefined) },
      reportError: message => { if (exportJob) void browserJson(prefix + '/exports/' + encode(exportJob) + '/error', body({ message })).catch(() => undefined) },
    },
    clipboard: {
      writeText: value => navigator.clipboard.writeText(value),
      async readImagePngBase64() {
        for (const item of await navigator.clipboard.read()) {
          if (!item.types.includes('image/png')) continue
          const blob = await item.getType('image/png')
          const bytes = new Uint8Array(await blob.arrayBuffer())
          let raw = ''
          for (const byte of bytes) raw += String.fromCharCode(byte)
          return { base64: btoa(raw) }
        }
        return null
      },
      readFilePaths: async () => { throw new Error('Use Paste, file selection, or drag-and-drop to import browser files') },
    },
    collectLocalTreeImport: unavailable, readLocalFileBinary: unavailable,
    revealInFileManager: async (path, source) => {
      if (source && source !== viewId && browserContext(source)) return browserContext(source)!.platform.revealInFileManager(path, source)
      await api('/files/reveal', workspaceBody({ path })); return { success: true }
    },
    openLocalFileWithSystemApp: async (path, source) => {
      if (source && source !== viewId && browserContext(source)) return browserContext(source)!.platform.openLocalFileWithSystemApp(path, source)
      await api('/files/open', workspaceBody({ path })); return { success: true }
    },
    backup,
    ssh: {
      listHosts: async () => (await browserJson<Array<Data>>('/api/browser/ssh/hosts')).map(host => ({ ...host, port: String(host.port) })) as SshHostPayload[],
      saveHost: async input => { const saved = await browserJson<Data>('/api/browser/ssh/hosts', body({ id: input.id, alias: input.alias, hostname: input.hostname, user: input.user, port: input.port || '22', identityFile: input.identityFile, authMethod: input.authMethod, password: input.password, passphrase: input.passphrase, rememberSecret: input.rememberSecret !== false })); return { ...saved, port: String(saved.port) } as SshHostPayload },
      deleteHost: id => browserJson('/api/browser/ssh/hosts/' + encode(id), { method: 'DELETE' }),
      async pickIdentityFile() { const path = await chooseDirectory(bootstrap.homeDir, { mode: 'openFile', title: 'Select SSH private key on this Host' }); return path ? { canceled: false, ...await browserJson<{ path: string }>('/api/browser/ssh/identity', body({ path })) } : { canceled: true } },
    },
    remote: {
      connectSsh: async host => { if (bootstrap.remote && host.id === bootstrap.workspace.hostId) return bootstrap.remote; await openRemoteWorkspace(host); throw new Error('The remote Workspace opened in another browser tab') },
      disconnect: async () => { disconnect(viewId); return { disconnected: true } },
      status: async () => bootstrap.remote || null,
    },
    desktop: {
      async connect(tabId) {
        bootstrap = await browserJson<BrowserBootstrap>(prefix + '/bootstrap')
        serviceListeners.forEach(listener => listener(bootstrap.service))
        if (bootstrap.protocol !== 1) throw new BrowserApiError('This page needs a matching Hulala service version. Reload the page after saving your work.', 409, 'protocol_mismatch')
        if (!options.reference && !upgradeNotified && bootstrap.version !== loadedVersion) {
          upgradeNotified = true
          window.dispatchEvent(new CustomEvent('hulala:notice', { detail: { message: `Hulala ${bootstrap.version} is running. Save your changes, then reload this tab to load its updated interface.`, actionLabel: 'Reload', action: async () => { location.reload() } } }))
        }
        await browserJson(prefix + '/views', body({ viewId }))
        workspace = bootstrap.nativeWorkspace
        sockets.get(tabId)?.close()
        const url = new URL(prefix + '/events', location.origin)
        url.searchParams.set('viewId', viewId)
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
        const socket = new WebSocket(url)
        sockets.set(tabId, socket)
        return new Promise<{ instanceId: string }>((resolve, reject) => {
          const timeout = window.setTimeout(() => { socket.close(); reject(new Error('Workspace connection timed out')) }, 15000)
          socket.addEventListener('message', message => {
            if (sockets.get(tabId) !== socket) return
            const event = JSON.parse(String(message.data)) as Data
            if (event.type === 'browser.connected') { clearTimeout(timeout); connection(tabId, 'connected'); refreshSettings(); void backup.flush().catch(() => undefined); resolve({ instanceId: bootstrap.instanceId }); return }
            if (event.type === 'browser.settingsChanged') { refreshSettings(); return }
            eventListeners.forEach(handler => handler({ tabId, event }))
          })
          socket.addEventListener('close', () => {
            clearTimeout(timeout)
            if (sockets.get(tabId) === socket) { sockets.delete(tabId); connection(tabId, 'disconnected') }
            reject(new Error('Workspace connection closed'))
          })
          socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Workspace connection failed')) })
        })
      },
      disconnect: async tabId => { disconnect(tabId); return { disconnected: true } },
      workspaceContext: async () => ({ instanceId: bootstrap.instanceId, workspace }),
      workspaces: {
        async createManaged(target, name) {
          if (target.kind !== 'local') throw new Error('Remote workspace creation requires an SSH connection')
          const page = location.pathname === '/open' ? null : reserveWorkspacePage()
          try {
            const value = await browserJson<BrowserWorkspace>('/api/browser/workspaces/managed', body({ name }))
            reservedPages.set(value.path, page)
            return { ok: true, workspace: value }
          } catch (error) { page?.close(); return { ok: false, code: 'workspace_create_failed', message: String(error) } }
        },
      },
      files: {
        stat: (_tab, path) => api('/files/stat' + scopedQuery('', path)),
        readdir: (_tab, path) => api('/files/readdir' + scopedQuery('', path)),
        readText: (_tab, path) => api('/files/text' + scopedQuery('', path)),
        writeText: (_tab, path, content, expectedVersion) => api('/files/text', workspaceBody({ path, content, expectedVersion }, 'PUT')),
        mkdir: (_tab, path) => api('/files/mkdir', workspaceBody({ path })),
        delete: (_tab, path) => api('/files', workspaceBody({ path }, 'DELETE')),
        move: (_tab, from, to, copy) => api(copy ? '/files/copy' : '/files/rename', workspaceBody({ from, to })),
        search: (_tab, path, query, limit = 200, options = {}) => {
          const params = new URLSearchParams({ query, limit: String(limit), regex: String(Boolean(options.regex)), matchCase: String(Boolean(options.matchCase)), wholeWord: String(Boolean(options.wholeWord)) })
          for (const pattern of options.includes || []) params.append('include', pattern)
          for (const pattern of options.excludes || []) params.append('exclude', pattern)
          return api('/files/search' + scopedQuery('', path) + '&' + params)
        },
      },
      resources: {
        async handle(_tab, path) { const value = await api('/resources', workspaceBody({ path })); return { ...value, url: prefix + '/api/resources/' + encode(value.id) } },
        async import(_tab, path, data, contentType, expectedVersion, upload) {
          // Refresh process-scoped authorization before beginning the streaming upload.
          await browserJson(prefix + '/bootstrap')
          const result = await uploadBrowserResource(prefix + '/api/resources/import' + scopedQuery('', path) + (expectedVersion ? '&expectedVersion=' + encode(expectedVersion) : ''), data, contentType || 'application/octet-stream', upload)
          return { ...result, resource: { ...result.resource, url: prefix + '/api/resources/' + encode(result.resource.id) } }
        },
      },
      commands: {
        start: (_tab, input) => api('/commands', workspaceBody({ command: input.command, cwd: input.cwd, requestId: input.requestId })),
        list: () => api('/commands' + scopedQuery('')),
        get: (_tab, id) => api('/commands/' + encode(id)),
        write: (_tab, id, data) => api('/commands/' + encode(id) + '/input', body({ data })),
        stop: (_tab, commandId) => api('/commands/' + encode(commandId), { method: 'DELETE' }),
      },
      git: {
        async branches() { const [branches, status] = await Promise.all([api('/git/branches' + scopedQuery('')), api('/git/status' + scopedQuery(''))]); return { workspace, branches, status } },
        async checkout(_tab, input) { await api('/git/checkout', workspaceBody({ branch: input.branch, create: input.create })); return { workspace, branch: input.branch } },
      },
      cron: {
        list: () => api('/cron'),
        create: (_tab, input) => { const task = input as Data; return api('/cron' + (task.id ? '/' + encode(task.id) : ''), workspaceBody({ name: task.name, description: task.description, cwd: task.target?.cwd, modelKey: task.payload?.data?.modelKey, expectedRevision: task.revision, requestId: task.requestId, schedule: task.schedule, prompt: task.payload?.text || '', enabled: task.enabled !== false }, task.id ? 'PATCH' : 'POST')) },
        run: (_tab, id, requestId) => api('/cron/' + encode(id) + '/run', body({ requestId })),
        remove: (_tab, id) => api('/cron/' + encode(id), { method: 'DELETE' }),
        history: (_tab, id, limit = 99) => api('/cron/' + encode(id) + '/history?limit=' + limit),
      },
      messenger: {
        list: (_tab, includeArchived = false) => api('/messages?includeArchived=' + includeArchived),
        reply: (_tab, id, text, requestId) => api('/messages/' + encode(id) + '/reply', body({ text, requestId })),
        update: (_tab, id, action) => api('/messages/' + encode(id), body({ action }, 'PATCH')),
      },
      conversation: {
        open: (_tab, _path, intent) => api('/conversations/open', workspaceBody(intent)),
        list: () => api('/conversations' + scopedQuery('')),
        create: (_tab, _path, agentPreset) => api('/conversations', workspaceBody({ agentPreset })),
        history: (_tab, id, beforeSeq, maxMessages = 200) => api(session(id, '/history?maxMessages=' + maxMessages + (beforeSeq === undefined ? '' : '&beforeSeq=' + beforeSeq))),
        async copySessionPath(_tab, id) { const value = await api(session(id, '/location')); await navigator.clipboard.writeText(value.path); return { copied: true } },
        send: (_tab, id, input) => api(session(id, '/prompt'), body(input)),
        cancel: (_tab, id) => api(session(id, '/cancel'), { method: 'POST' }),
        fork: (_tab, id, atSeq) => api(session(id, '/fork'), body({ atSeq })),
        rename: (_tab, id, title) => api(session(id, '/rename'), body({ title }, 'PATCH')),
        archive: (_tab, id) => api(session(id, '/archive'), { method: 'POST' }),
        models: (_tab, id) => api(session(id, '/models')),
        selectModel: (_tab, id, selection) => api(session(id, '/model'), body(selection, 'PUT')),
        selectAgentPreset: (_tab, id, agentPreset) => api(session(id, '/agent-preset'), body({ agentPreset }, 'PUT')),
        updateQueue: (_tab, id, itemId, action) => api(session(id, '/queue/' + encode(itemId)), body(action, 'PATCH')),
        answerInteraction: (_tab, id, answer) => api('/conversations/interactions/' + encode(id), body(answer)),
        loadAttachment: async (_tab, id, attachmentId) => ({ url: prefix + '/api' + session(id, '/attachments/' + encode(attachmentId)) }),
        imageUploadUrl: (_tab, id, uploadId) => prefix + '/api' + session(id, '/uploads/' + encode(uploadId)),
        async uploadImage(_tab, id, uploadId, file, name, options) {
          await browserJson(prefix + '/bootstrap')
          const url = prefix + '/api' + session(id, '/uploads/' + encode(uploadId))
          const result = await uploadBrowserResource(url + (name ? '?name=' + encode(name) : ''), file, file.type, options)
          return { ...result, url }
        },
        discardImage: (_tab, id, uploadId) => api(session(id, '/uploads/' + encode(uploadId)), { method: 'DELETE' }),
        listSkills: (_tab, id) => api(session(id, '/skills')),
        listCommands: (_tab, id) => api(session(id, '/commands')),
        executeCommand: (_tab, id, line, images = []) => api(session(id, '/command'), body({ line, images })),
        listSubagents: (_tab, id) => api(session(id, '/subagents')),
        listAgentPresets: () => api('/conversations/agent-presets'),
      },
      onConnection: handler => { connectionListeners.add(handler); return () => { connectionListeners.delete(handler) } },
      onEvent: handler => { eventListeners.add(handler); return () => { eventListeners.delete(handler) } },
    },
    harness: {
      getRuntimeState: sessionId => api<HarnessRuntimeState>('/harness/runtime-state' + (sessionId ? '?sessionId=' + encode(sessionId) : '')).then(presentRuntimeState),
      selectRuntime: input => api<HarnessRuntimeState>('/harness/runtime-selection', body(input)).then(presentRuntimeState),
      providerAuth: {
        describeOpenAICodex: () => api('/harness/provider-auth/openai-codex'),
        startOpenAICodex: () => api('/harness/provider-auth/openai-codex/start', { method: 'POST' }),
        answerOpenAICodex: (attemptId, promptId, value) => api('/harness/provider-auth/openai-codex/answer', body({ attemptId, promptId, value })),
        cancelOpenAICodex: attemptId => api('/harness/provider-auth/openai-codex/cancel', body({ attemptId })),
        enableOpenAICodex: () => api('/harness/provider-auth/openai-codex/enable', { method: 'POST' }),
        signOutOpenAICodex: () => api('/harness/provider-auth/openai-codex/sign-out', { method: 'POST' }),
        openOpenAICodexAuthorizationPage: async url => { const parsed = new URL(url); if (parsed.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com'].includes(parsed.hostname)) throw new Error('Invalid authorization page'); external(url) },
      },
      settings: { describe: () => api('/harness/settings/describe'), mutate: input => api('/harness/settings/mutate', body(input)), openDocument: () => openHarnessDocument('/harness/settings/open-document') },
      llm: { providers: () => api('/harness/llm/providers'), discoverModels: input => api('/harness/llm/discover-models', body(input)) },
      credentials: { describe: refs => api('/harness/credentials/describe', body({ refs })), set: (ref, value) => api('/harness/credentials/set', body({ ref, value })), unset: ref => api('/harness/credentials/unset', body({ ref })) },
      agentPresets: {
        list: () => api('/harness/agent-presets'), read: agentPreset => api('/harness/agent-presets/read', body({ agentPreset })),
        copy: (from, agentPreset, name) => api('/harness/agent-presets/copy', body({ from, agentPreset, name })),
        openDocument: agentPreset => openHarnessDocument('/harness/agent-presets/open-document', { agentPreset }),
        remove: agentPreset => api('/harness/agent-presets/remove', body({ agentPreset })),
      },
      listPlugins: () => api('/harness/plugins'),
    },
    localPlugins: {
      assetUrl: (id, revision, file) => prefix + '/api/plugins/assets/' + encode(id) + '/' + encode(revision) + '/' + file.split('/').map(encode).join('/'),
      list: () => api('/plugins'),
      async install() {
        const hostId = bootstrap.workspace.hostId
        const path = await chooseDirectory(workspace.path, hostId ? {
          title: 'Plugin directory · ' + bootstrap.workspace.hostLabel,
          provider: { kind: 'remote', listDirectory: path => browserJson('/api/browser/ssh/directories?' + new URLSearchParams({ hostId, path })),
            statPath: path => browserJson('/api/browser/ssh/directories/stat?' + new URLSearchParams({ hostId, path })),
            getQuickAccess: async () => [{ key: 'workspace', label: 'Workspace', path: workspace.path }] },
        } : { title: 'Plugin directory on the local Host' })
        return path ? api('/plugins', body({ action: 'install', path })) : null
      },
      enable: (id, enabled) => api('/plugins', body({ action: 'enable', id, enabled })),
      uninstall: id => api('/plugins', body({ action: 'uninstall', id })),
      rollback: (id, revision) => api('/plugins', body({ action: 'rollback', id, revision })),
      rpc: (id, method, input) => api('/plugins', body({ action: 'rpc', id, method, input })),
      events: after => api('/plugins/events?after=' + after),
      configureSecret: (id, name) => configureBrowserSecret(id, name, value => api('/plugins', body({ action: 'secret', id, name, value }))),
      unsetSecret: (id, name) => api('/plugins', body({ action: 'secret', id, name })),
      openExternal: async url => external(url),
    },
    window: {
      list: async () => [{ id: 1, title: bootstrap.workspace.name, workspacePath: workspace.path, mode: bootstrap.workspace.kind, active: document.hasFocus() }],
      getBootstrap: async () => ({ windowId: 1, info: { active: document.hasFocus(), mode: bootstrap.workspace.kind, remoteHost: bootstrap.remoteHost, workspacePath: workspace.path, presentation: location.pathname === '/open' ? 'newWindowLanding' : 'default' }, workspaceTabsSession: { version: 4, activeTabId: viewId, tabs: [{ ...(saved?.tabs?.[0] || {}), id: viewId, kind: bootstrap.workspace.kind, remoteHost: bootstrap.remoteHost, workspacePath: workspace.path, currentDir: workspace.path, workspaceId: bootstrap.workspace.id, label: bootstrap.workspace.name }] }, initialWorkspace: { mode: bootstrap.workspace.kind, remoteHost: bootstrap.remoteHost, workspacePath: workspace.path } }),
      updateWorkspaceTabsSession: async snapshot => { sessionStore.setItem(stateKey, JSON.stringify(snapshot)); return snapshot },
      createNew: async () => { window.open('/open', '_blank', 'noopener'); return { requested: true } },
      completeNewWindowLanding: async () => ({ success: true }),
      createLocal: async options => {
        if (options?.path) { await openBrowserWorkspace(options.path); return { opened: true } }
        return { opened: Boolean(await openLocalWorkspaceDirectory(bootstrap.defaultDir)) }
      },
      createRemote: async host => { await openRemoteWorkspace(host); return { requested: true } },
      focus: async () => { window.focus(); return { active: document.hasFocus() } },
      close: async () => { window.close(); return { closed: window.closed } },
      onListChanged: handler => { const changed = () => { void platform.window.list().then(handler) }; window.addEventListener('focus', changed); return () => window.removeEventListener('focus', changed) },
      onActiveChanged: handler => { const changed = () => handler({ active: !document.hidden }); document.addEventListener('visibilitychange', changed); return () => { document.removeEventListener('visibilitychange', changed) } },
    },
    serviceInfo: { get: async () => bootstrap.service, onChanged: handler => { serviceListeners.add(handler); return () => { serviceListeners.delete(handler) } } },
    settings: {
      get: readSettings, getRoot: async () => bootstrap.settingsRoot,
      getDefaultWorkspace: async () => { const current = await browserJson('/api/browser/settings'); const configuredPath = current.user?.defaultWorkspacePath || null; return { configuredPath, defaultPath: bootstrap.defaultDir, effectivePath: configuredPath || bootstrap.defaultDir } },
      pickDefaultWorkspace: async () => { const path = await chooseDirectory(bootstrap.defaultDir); return path ? { canceled: false, path } : { canceled: true } },
      async set(patch) { const value = await browserJson('/api/browser/settings', body(patch, 'PATCH')); latestSettings = value; settingsListeners.forEach(handler => handler(value)); settingsChannel?.postMessage({ changed: true }); return value },
      previewMarkdownTextOffset: value => settingsListeners.forEach(handler => handler({ ...latestSettings, ui: { ...latestSettings?.ui, markdownTextOffset: value } })),
      previewMarkdownContentWidth: value => settingsListeners.forEach(handler => handler({ ...latestSettings, ui: { ...latestSettings?.ui, markdownContentWidth: value } })),
      onChanged: handler => { settingsListeners.add(handler); return () => { settingsListeners.delete(handler) } },
    },
  }
  if (!exportJob) installBrowserContext({ viewId, workspace: bootstrap.workspace, platform })
  if (!options.reference) document.title = location.pathname === '/open' ? 'Open Workspace · Hulala' : bootstrap.workspace.name + (bootstrap.workspace.hostLabel ? ' @ ' + bootstrap.workspace.hostLabel : '') + ' · Hulala'
  return platform
}
