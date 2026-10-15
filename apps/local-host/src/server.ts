import { basename, join } from 'node:path'
import { z } from 'zod'
import {
  API_PREFIX,
  archiveInputSchema,
  commandInputSchema,
  commandWriteInputSchema,
  connectionDescriptorSchema,
  conversationCommandInputSchema,
  conversationAgentPresetSelectionSchema,
  conversationCreateInputSchema,
  conversationForkInputSchema,
  conversationInteractionAnswerSchema,
  conversationIntentSchema,
  conversationModelSelectionInputSchema,
  conversationPromptInputSchema,
  conversationQueueUpdateInputSchema,
  conversationRenameInputSchema,
  cronInputSchema,
  fileMoveInputSchema,
  fileTextInputSchema,
  gitCheckoutInputSchema,
  messageReplyInputSchema,
  messageUpdateInputSchema,
  managedWorkspaceInputSchema,
  providerAuthorizationAnswerInputSchema,
  providerAuthorizationCancelInputSchema,
  transferCommitInputSchema,
  workspaceInputSchema,
  workspacePathInputSchema,
  type ConnectionDescriptor,
  type HulalaPaths,
} from '@hulala/workbench-contracts'
import { pluginRoute } from './localPlugins/routes.ts'
import { ArchiveService } from './archive.ts'
import { allowedLocalOrigin, authorizeRequest, connectionCookieName, createConnectionToken } from './auth.ts'
import { CommandService } from './commands.ts'
import { ConversationService } from './conversation.ts'
import { ensureServerPaths, type ServerConfig } from './config.ts'
import { CronService } from './cron.ts'
import { ServerDatabase } from './database.ts'
import { EventHub, type EventSocketData } from './events.ts'
import { resolveHulalaPaths } from '@hulala/workbench-contracts/paths'
import { ProtectedPaths, providerCredentialPaths, selectedSshIdentityPaths } from './protectedPaths'
import { WorkspaceFiles } from './files.ts'
import { GitService } from './git.ts'
import { errorResponse, HttpError, json, parseJson } from './http.ts'
import { MessengerService } from './messenger.ts'
import { OpenAICodexAuthorizationController } from './providerAuthorization.ts'
import { ResourceService } from './resources.ts'
import { ConversationUploads } from './conversationUploads'
import { HarnessApiAdapter, HarnessEndpointState, type HarnessInProcessServices } from './runtime.ts'
import { WorkspaceWatchService } from './watch.ts'
import { openSystemFile } from './systemFiles'
import { WorkspaceRegistry } from './workspaces.ts'

type SocketData = EventSocketData

export interface DesktopServerHandle {
  descriptor: ConnectionDescriptor
  paths: HulalaPaths
  stop(): Promise<void>
}

function relativeApiPath(pathname: string): string {
  return pathname.slice(API_PREFIX.length) || '/'
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin')
  return origin && allowedLocalOrigin(origin) ? {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-hulala-token',
    'access-control-max-age': '600',
    vary: 'origin',
  } : {}
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(corsHeaders(request))) headers.set(name, String(value))
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function parseInteger(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : fallback
}

function inlineContentDisposition(fileName: string): string {
  const normalized = basename(fileName || 'resource') || 'resource'
  const fallback = normalized
    .replace(/[\x00-\x1f\x7f-\uffff]/g, '_')
    .replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(normalized)
    .replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `inline; filename="${fallback || 'resource'}"; filename*=UTF-8''${encoded}`
}

export async function createDesktopServer(
  config: ServerConfig,
  harnessServices: HarnessInProcessServices = {},
): Promise<DesktopServerHandle> {
  const paths = await ensureServerPaths(config)
  const token = createConnectionToken()
  const instanceId = crypto.randomUUID()
  const authCookieName = connectionCookieName(instanceId)
  const startedAt = new Date().toISOString()
  const database = harnessServices.productDatabase ?? new ServerDatabase(paths)
  const ownsDatabase = harnessServices.productDatabase === undefined
  const events = new EventHub()
  if (harnessServices.workspaceRegistry === undefined) throw new Error('Harness workspace registry is required')
  if (harnessServices.fs === undefined) throw new Error('Harness filesystem provider is required')
  const workspaces = new WorkspaceRegistry(paths, harnessServices.workspaceRegistry, !config.workspaceId)
  await workspaces.initialize()
  const credentialRoot = resolveHulalaPaths(config.hulalaRoot, config.workspaceRoot).config
  const files = new WorkspaceFiles(harnessServices.fs, harnessServices.subprocess, new ProtectedPaths(providerCredentialPaths(credentialRoot), () => selectedSshIdentityPaths(credentialRoot)))
  const commands = new CommandService(events, harnessServices.subprocess, join(paths.server, 'commands'))
  await commands.initialize()
  const git = new GitService(harnessServices.subprocess, files)
  const resources = new ResourceService(paths, files)
  const resourceCleanup = setInterval(() => void resources.pruneExpired(), 60_000)
  const messenger = new MessengerService(database, events)
  const runtime = new HarnessEndpointState(
    events,
    harnessServices.typertGateway !== undefined,
  )
  const conversationUploads = new ConversationUploads(join(paths.transfers, 'conversation-images'), harnessServices.attachments)
  const harness = new HarnessApiAdapter({ ...harnessServices, conversationUploads })
  const openAICodexAuthorization = new OpenAICodexAuthorizationController(
    harness,
    harnessServices.authorization,
    harnessServices.credentials,
  )
  const conversations = new ConversationService(harness, events)
  const cron = new CronService(database, events, harness, messenger, workspaces)
  const archive = new ArchiveService(database, files)
  const watchers = new WorkspaceWatchService(events)
  for (const workspace of workspaces.list()) watchers.watch(workspace)
  let quiescing = false, inflightWrites = 0
  let quiesceTimer: ReturnType<typeof setTimeout> | undefined

  const server = Bun.serve<SocketData>({
    hostname: config.host,
    port: config.port,
    maxRequestBodySize: 256 * 1024 * 1024,
    async fetch(request, server) {
      let mutation = false
      try {
        if (request.method === 'OPTIONS') {
          if (request.headers.get('origin') !== new URL(request.url).origin) throw new HttpError(403, 'origin_forbidden', 'origin is not allowed')
          return new Response(null, { status: 204, headers: corsHeaders(request) })
        }
        const url = new URL(request.url)
        if (!authorizeRequest(request, token, authCookieName)) {
          throw new HttpError(403, 'request_forbidden', 'request is not authorized')
        }
        if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
          if (url.pathname === `${API_PREFIX}/events`) {
            return server.upgrade(request, { data: { kind: 'events' } }) ? undefined : new Response('upgrade failed', { status: 400 })
          }
          throw new HttpError(404, 'route_not_found', 'route not found')
        }
        if (!url.pathname.startsWith(API_PREFIX)) {
          throw new HttpError(404, 'route_not_found', 'route not found')
        }

        const path = relativeApiPath(url.pathname)
        if (path !== '/lifecycle' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
          if (quiescing) throw new HttpError(409, 'host_restarting', 'The Workspace Host is preparing to restart. Keep your draft open and retry after reconnecting.')
          inflightWrites++; mutation = true
        }
        let response: Response
        if (path === '/lifecycle' && ['GET', 'POST'].includes(request.method)) {
          if (request.method === 'POST') {
            quiescing = (await parseJson(request, z.object({ quiesce: z.boolean() }).strict())).quiesce
            if (quiescing) {
              const deadline = Date.now() + 20000
              while (inflightWrites && Date.now() < deadline) await Bun.sleep(20)
              if (inflightWrites) { quiescing = false; throw new HttpError(409, 'writes_in_progress', 'Workspace writes are still in progress') }
            }
            await cron.quiesce(quiescing)
            clearTimeout(quiesceTimer)
            if (quiescing) {
              quiesceTimer = setTimeout(() => { quiescing = false; void cron.quiesce(false) }, 60000)
              quiesceTimer.unref()
            }
          }
          response = json({ commands: commands.busyCount(), conversations: (await harness.listSessions()).filter(session => session.running).length,
            cron: cron.list().filter(job => ['queued', 'running'].includes(job.lastRun?.state || '')).length,
            plugins: harnessServices.localPlugins?.list().filter(plugin => plugin.state === 'active').length || 0 })
        } else if (path === '/plugins' || path.startsWith('/plugins/')) {
          response = await pluginRoute(harnessServices.localPlugins, path, request)
        } else if (path === '/health' && request.method === 'GET') {
          response = json({
            name: 'hulala-desktop-server', version: config.version, instanceId, pid: process.pid, startedAt, runtime: runtime.status(),
            paths: { root: paths.root, workspace: paths.workspace },
          })
        } else if (path === '/runtime/status' && request.method === 'GET') {
          response = json(runtime.status())
        } else if (path === '/harness/runtime-state' && request.method === 'GET') {
          response = json(await harness.runtimeState(url.searchParams.get('sessionId') ?? undefined))
        } else if (path === '/harness/runtime-selection' && request.method === 'POST') {
          response = json(await harness.selectRuntime(await parseJson(request, z.record(z.string(), z.unknown()))))
        } else if (path === '/harness/provider-auth/openai-codex' && request.method === 'GET') {
          response = json(await openAICodexAuthorization.describe())
        } else if (path === '/harness/provider-auth/openai-codex/start' && request.method === 'POST') {
          response = json(await openAICodexAuthorization.start())
        } else if (path === '/harness/provider-auth/openai-codex/answer' && request.method === 'POST') {
          const input = await parseJson(request, providerAuthorizationAnswerInputSchema)
          response = json(await openAICodexAuthorization.answer(input.attemptId, input.promptId, input.value))
        } else if (path === '/harness/provider-auth/openai-codex/cancel' && request.method === 'POST') {
          const input = await parseJson(request, providerAuthorizationCancelInputSchema)
          response = json(await openAICodexAuthorization.cancel(input.attemptId))
        } else if (path === '/harness/provider-auth/openai-codex/enable' && request.method === 'POST') {
          response = json(await openAICodexAuthorization.enable())
        } else if (path === '/harness/provider-auth/openai-codex/sign-out' && request.method === 'POST') {
          response = json(await openAICodexAuthorization.signOut())
        } else if (path === '/harness/settings/describe' && request.method === 'GET') {
          response = json(await harness.settingsDescribe())
        } else if (path === '/harness/settings/mutate' && request.method === 'POST') {
          response = json(await harness.settingsMutate(await parseJson(request, z.record(z.string(), z.unknown()))))
        } else if (path === '/harness/settings/open-document' && request.method === 'POST') {
          response = json(await harness.settingsOpenDocument())
        } else if (path === '/harness/llm/providers' && request.method === 'GET') {
          response = json(await harness.llmProviders())
        } else if (path === '/harness/llm/discover-models' && request.method === 'POST') {
          response = json(await harness.llmDiscoverModels(await parseJson(request, z.record(z.string(), z.unknown()))))
        } else if (path === '/harness/credentials/describe' && request.method === 'POST') {
          response = json(await harness.credentialsDescribe(await parseJson(request, z.record(z.string(), z.unknown()))))
        } else if (path === '/harness/credentials/set' && request.method === 'POST') {
          response = json(await harness.credentialsSet(await parseJson(request, z.record(z.string(), z.unknown()))))
        } else if (path === '/harness/credentials/unset' && request.method === 'POST') {
          response = json(await harness.credentialsUnset(await parseJson(request, z.record(z.string(), z.unknown()))))
        } else if (path === '/harness/agent-presets' && request.method === 'GET') {
          response = json(await harness.agentPresetList())
        } else if (path === '/harness/agent-presets/read' && request.method === 'POST') {
          response = json(await harness.agentPresetRead(await parseJson(request, z.record(z.string(), z.unknown()))))
        } else if (path === '/harness/agent-presets/copy' && request.method === 'POST') {
          response = json(await harness.agentPresetCopy(await parseJson(request, z.record(z.string(), z.unknown()))))
        } else if (path === '/harness/agent-presets/open-document' && request.method === 'POST') {
          response = json(await harness.agentPresetOpenDocument(await parseJson(request, z.record(z.string(), z.unknown()))))
        } else if (path === '/harness/agent-presets/remove' && request.method === 'POST') {
          response = json(await harness.agentPresetRemove(await parseJson(request, z.record(z.string(), z.unknown()))))
        } else if (path === '/harness/plugins' && request.method === 'GET') {
          response = json(await harness.pluginInventory())
        } else if (path === '/conversations/open' && request.method === 'POST') {
          const input = await parseJson(request, conversationIntentSchema)
          const opened = await conversations.open(input, workspaces.get(input.workspaceId).path)
          response = json({
            ...opened,
            workspaceId: input.workspaceId,
            snapshot: { ...opened.snapshot, session: { ...opened.snapshot.session, workspaceId: input.workspaceId } },
          })
        } else if (path === '/conversations' && request.method === 'GET') {
          const workspaceId = url.searchParams.get('workspaceId')
          response = json({ items: workspaceId ? await conversations.listForPath(workspaces.get(workspaceId).path) : await conversations.list() })
        } else if (path === '/conversations' && request.method === 'POST') {
          const input = await parseJson(request, conversationCreateInputSchema)
          const opened = await conversations.create(workspaces.get(input.workspaceId).path, input.agentPreset)
          response = json({ ...opened, workspaceId: input.workspaceId, snapshot: { ...opened.snapshot, session: { ...opened.snapshot.session, workspaceId: input.workspaceId } } }, 201)
        } else if (/^\/conversations\/[^/]+\/history$/.test(path) && request.method === 'GET') {
          const sessionId = decodeURIComponent(path.split('/')[2])
          const beforeSeq = url.searchParams.has('beforeSeq') ? parseInteger(url.searchParams.get('beforeSeq'), -1) : undefined
          const maxMessages = Math.max(1, Math.min(400, parseInteger(url.searchParams.get('maxMessages'), beforeSeq === undefined ? 400 : 200)))
          response = json(await conversations.snapshot(sessionId, { ...(beforeSeq === undefined || beforeSeq < 0 ? {} : { beforeSeq }), maxMessages }))
        } else if (/^\/conversations\/[^/]+\/location$/.test(path) && request.method === 'GET') {
          response = json(await conversations.location(decodeURIComponent(path.split('/')[2])))
        } else if (/^\/conversations\/[^/]+\/prompt$/.test(path) && request.method === 'POST') {
          const input = await parseJson(request, conversationPromptInputSchema, 2 * 1024 * 1024)
          if (input.content.some(part => part.type === 'image' && (!part.uploadId || part.data))) throw new HttpError(400, 'image_upload_required', 'Upload image bytes before sending the message')
          response = json(await conversations.prompt(decodeURIComponent(path.split('/')[2]), input))
        } else if (/^\/conversations\/[^/]+\/uploads\/[^/]+$/.test(path)) {
          const parts = path.split('/')
          const sessionId = decodeURIComponent(parts[2]!), uploadId = decodeURIComponent(parts[4]!)
          if (!(await harness.listSessions()).some(session => session.sessionId === sessionId)) throw new HttpError(404, 'session_not_found', 'Conversation not found')
          if (request.method === 'PUT') response = json(await conversationUploads.upload(sessionId, uploadId, request))
          else if (request.method === 'GET') response = await conversationUploads.image(sessionId, uploadId)
          else if (request.method === 'DELETE') { await conversationUploads.discard(sessionId, uploadId); response = json({ removed: true }) }
          else throw new HttpError(405, 'method_not_allowed', 'Unsupported image upload operation')
        } else if (/^\/conversations\/[^/]+\/cancel$/.test(path) && request.method === 'POST') {
          response = json(await conversations.cancel(decodeURIComponent(path.split('/')[2])))
        } else if (/^\/conversations\/[^/]+\/fork$/.test(path) && request.method === 'POST') {
          const input = await parseJson(request, conversationForkInputSchema)
          response = json(await conversations.fork(decodeURIComponent(path.split('/')[2]), input.atSeq), 201)
        } else if (/^\/conversations\/[^/]+\/rename$/.test(path) && request.method === 'PATCH') {
          const input = await parseJson(request, conversationRenameInputSchema)
          response = json(await conversations.rename(decodeURIComponent(path.split('/')[2]), input.title))
        } else if (/^\/conversations\/[^/]+\/archive$/.test(path) && request.method === 'POST') {
          response = json(await conversations.archive(decodeURIComponent(path.split('/')[2])))
        } else if (/^\/conversations\/[^/]+\/models$/.test(path) && request.method === 'GET') {
          response = json(await conversations.models(decodeURIComponent(path.split('/')[2])))
        } else if (/^\/conversations\/[^/]+\/model$/.test(path) && request.method === 'PUT') {
          response = json(await conversations.selectModel(decodeURIComponent(path.split('/')[2]), await parseJson(request, conversationModelSelectionInputSchema)))
        } else if (/^\/conversations\/[^/]+\/agent-preset$/.test(path) && request.method === 'PUT') {
          response = json(await conversations.selectAgentPreset(
            decodeURIComponent(path.split('/')[2]),
            (await parseJson(request, conversationAgentPresetSelectionSchema)).agentPreset,
          ))
        } else if (/^\/conversations\/[^/]+\/queue\/[^/]+$/.test(path) && request.method === 'PATCH') {
          const parts = path.split('/')
          response = json(await conversations.updateQueue(decodeURIComponent(parts[2]), decodeURIComponent(parts[4]), await parseJson(request, conversationQueueUpdateInputSchema)))
        } else if (/^\/conversations\/[^/]+\/attachments\/[^/]+$/.test(path) && request.method === 'GET') {
          const parts = path.split('/')
          const image = await conversations.attachment(decodeURIComponent(parts[2]), decodeURIComponent(parts[4])) as { attachment: { mediaType: string }; data: string }
          if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.attachment.mediaType)) throw new HttpError(400, 'image_type_invalid', 'Unsupported image type')
          response = new Response(Buffer.from(image.data, 'base64'), { headers: { 'content-type': image.attachment.mediaType, 'cache-control': 'no-store', 'content-security-policy': "sandbox; default-src 'none'", 'x-content-type-options': 'nosniff' } })
        } else if (/^\/conversations\/[^/]+\/skills$/.test(path) && request.method === 'GET') {
          response = json(await conversations.skills(decodeURIComponent(path.split('/')[2])))
        } else if (/^\/conversations\/[^/]+\/commands$/.test(path) && request.method === 'GET') {
          response = json(await conversations.commands(decodeURIComponent(path.split('/')[2])))
        } else if (/^\/conversations\/[^/]+\/command$/.test(path) && request.method === 'POST') {
          response = json(await conversations.executeCommand(
            decodeURIComponent(path.split('/')[2]),
            await parseJson(request, conversationCommandInputSchema, 2 * 1024 * 1024),
          ))
        } else if (/^\/conversations\/[^/]+\/subagents$/.test(path) && request.method === 'GET') {
          response = json(await conversations.subagents(decodeURIComponent(path.split('/')[2])))
        } else if (/^\/conversations\/interactions\/[^/]+$/.test(path) && request.method === 'POST') {
          response = json(await conversations.answer(decodeURIComponent(path.split('/')[3]), await parseJson(request, conversationInteractionAnswerSchema)))
        } else if (path === '/conversations/agent-presets' && request.method === 'GET') {
          response = json(await conversations.agentPresets())
        } else if (path === '/workspaces' && request.method === 'GET') {
          response = json({ items: workspaces.list() })
        } else if (path === '/workspaces/managed' && request.method === 'POST') {
          const input = await parseJson(request, managedWorkspaceInputSchema)
          const workspace = await workspaces.createManaged(input.name)
          watchers.watch(workspace)
          response = json(workspace, 201)
        } else if (path === '/workspaces' && request.method === 'POST') {
          const workspace = await workspaces.add((await parseJson(request, workspaceInputSchema)).path)
          watchers.watch(workspace)
          response = json(workspace, 201)
        } else if (path === '/files/tree' && request.method === 'GET') {
          response = json(await files.tree(workspaces.get(url.searchParams.get('workspaceId') ?? ''), url.searchParams.get('path') ?? '.', parseInteger(url.searchParams.get('depth'), 2)))
        } else if (path === '/files/stat' && request.method === 'GET') {
          response = json(await files.stat(workspaces.get(url.searchParams.get('workspaceId') ?? ''), url.searchParams.get('path') ?? '.'))
        } else if (path === '/files/readdir' && request.method === 'GET') {
          response = json(await files.readdir(workspaces.get(url.searchParams.get('workspaceId') ?? ''), url.searchParams.get('path') ?? '.'))
        } else if (path === '/files/text' && request.method === 'GET') {
          response = json(await files.readText(workspaces.get(url.searchParams.get('workspaceId') ?? ''), url.searchParams.get('path') ?? ''))
        } else if (path === '/files/text' && request.method === 'PUT') {
          const input = await parseJson(request, fileTextInputSchema, 17 * 1024 * 1024)
          response = json(await files.writeText(workspaces.get(input.workspaceId), input.path, input.content, input.expectedVersion))
        } else if (path === '/files/mkdir' && request.method === 'POST') {
          const input = await parseJson(request, workspacePathInputSchema)
          await files.mkdir(workspaces.get(input.workspaceId), input.path)
          response = json({ ok: true })
        } else if (path === '/files' && request.method === 'DELETE') {
          const input = await parseJson(request, workspacePathInputSchema)
          await files.remove(workspaces.get(input.workspaceId), input.path)
          response = json({ ok: true })
        } else if (path === '/files/rename' && request.method === 'POST') {
          const input = await parseJson(request, fileMoveInputSchema)
          response = json({ ok: true, ...await files.rename(workspaces.get(input.workspaceId), input.from, input.to) })
        } else if (path === '/files/copy' && request.method === 'POST') {
          const input = await parseJson(request, fileMoveInputSchema)
          await files.copy(workspaces.get(input.workspaceId), input.from, input.to)
          response = json({ ok: true })
        } else if ((path === '/files/open' || path === '/files/reveal') && request.method === 'POST') {
          const input = await parseJson(request, workspacePathInputSchema)
          await openSystemFile(workspaces.get(input.workspaceId), input.path, path.endsWith('/reveal'))
          response = json({ success: true })
        } else if (path === '/files/search' && request.method === 'GET') {
          const patterns = (key: string) => url.searchParams.getAll(key).slice(0, 100).map(value => value.slice(0, 1024))
          response = json({ items: await files.search(workspaces.get(url.searchParams.get('workspaceId') ?? ''), url.searchParams.get('query') ?? '', parseInteger(url.searchParams.get('limit'), 200), {
            path: url.searchParams.get('path') || '.', regex: url.searchParams.get('regex') === 'true', matchCase: url.searchParams.get('matchCase') === 'true', wholeWord: url.searchParams.get('wholeWord') === 'true', includes: patterns('include'), excludes: patterns('exclude'),
          }) })
        } else if (path === '/resources' && request.method === 'POST') {
          const input = await parseJson(request, workspacePathInputSchema)
          response = json(await resources.createHandle(workspaces.get(input.workspaceId), input.path), 201)
        } else if (path === '/resources/import' && request.method === 'PUT') {
          const workspace = workspaces.get(url.searchParams.get('workspaceId') ?? '')
          const targetPath = url.searchParams.get('path') ?? ''
          const resource = await resources.importResource(
            workspace,
            targetPath,
            request.body,
            Number(request.headers.get('content-length') ?? '-1'),
            url.searchParams.get('expectedVersion'),
          )
          response = json({ ok: true, resource }, 201)
        } else if (path.startsWith('/resources/') && request.method === 'GET') {
          const file = await resources.openHandle(path.slice('/resources/'.length))
          response = new Response(file, {
            headers: {
              'content-type': file.type || 'application/octet-stream',
              'content-disposition': inlineContentDisposition(file.name ?? 'resource'),
            },
          })
        } else if (path === '/transfers' && request.method === 'POST') {
          response = json(await resources.createTransfer(), 201)
        } else if (/^\/transfers\/[^/]+\/content$/.test(path) && request.method === 'PUT') {
          const id = path.split('/')[2]
          await resources.uploadTransfer(id, request.body, Number(request.headers.get('content-length') ?? '-1'))
          response = json({ ok: true })
        } else if (/^\/transfers\/[^/]+\/commit$/.test(path) && request.method === 'POST') {
          const id = path.split('/')[2]
          const input = await parseJson(request, transferCommitInputSchema)
          const resource = await resources.commitTransfer(id, workspaces.get(input.workspaceId), input.path, input.expectedVersion)
          response = json({ ok: true, resource })
        } else if (path === '/commands' && request.method === 'GET') {
          response = json({ items: commands.list(workspaces.get(url.searchParams.get('workspaceId') || '').id) })
        } else if (/^\/commands\/[^/]+$/.test(path) && request.method === 'GET') {
          response = json(commands.snapshot(path.split('/')[2]!))
        } else if (path === '/commands' && request.method === 'POST') {
          const input = await parseJson(request, commandInputSchema)
          response = json(await commands.start(workspaces.get(input.workspaceId), input.command, input.cwd, input.requestId), 201)
        } else if (/^\/commands\/[^/]+\/input$/.test(path) && request.method === 'POST') {
          const input = await parseJson(request, commandWriteInputSchema)
          await commands.write(path.split('/')[2], input.data)
          response = json({ ok: true })
        } else if (path.startsWith('/commands/') && request.method === 'DELETE') {
          commands.stop(path.split('/')[2])
          response = json({ ok: true })
        } else if (path === '/git/status' && request.method === 'GET') {
          response = json(await git.status(workspaces.get(url.searchParams.get('workspaceId') ?? '')))
        } else if (path === '/git/branches' && request.method === 'GET') {
          response = json(await git.branches(workspaces.get(url.searchParams.get('workspaceId') ?? '')))
        } else if (path === '/git/checkout' && request.method === 'POST') {
          const input = await parseJson(request, gitCheckoutInputSchema)
          await git.checkout(workspaces.get(input.workspaceId), input.branch, input.create)
          response = json({ ok: true })
        } else if (path === '/cron' && request.method === 'GET') {
          response = json({ items: cron.list() })
        } else if (path === '/cron' && request.method === 'POST') {
          response = json(await cron.create(await parseJson(request, cronInputSchema)), 201)
        } else if (/^\/cron\/[^/]+$/.test(path) && request.method === 'PATCH') {
          response = json(await cron.update(path.split('/')[2], await parseJson(request, cronInputSchema)))
        } else if (/^\/cron\/[^/]+\/history$/.test(path) && request.method === 'GET') {
          response = json({ items: cron.history(path.split('/')[2], parseInteger(url.searchParams.get('limit'), 99)) })
        } else if (/^\/cron\/[^/]+\/run$/.test(path) && request.method === 'POST') {
          const input = request.body ? await parseJson(request, z.object({ requestId: z.string().uuid().optional() })) : {}
          response = json(await cron.run(path.split('/')[2], input.requestId))
        } else if (path.startsWith('/cron/') && request.method === 'DELETE') {
          cron.remove(path.split('/')[2])
          response = json({ ok: true })
        } else if (path === '/messages' && request.method === 'GET') {
          response = json({ items: messenger.list({ workspaceId: url.searchParams.get('workspaceId') ?? undefined, includeArchived: url.searchParams.get('includeArchived') === 'true' }) })
        } else if (path.startsWith('/messages/') && request.method === 'PATCH') {
          response = json(messenger.update(path.split('/')[2], (await parseJson(request, messageUpdateInputSchema)).action))
        } else if (/^\/messages\/[^/]+\/reply$/.test(path) && request.method === 'POST') {
          const input = await parseJson(request, messageReplyInputSchema)
          response = json(await messenger.reply(path.split('/')[2]!, input.text, input.requestId || crypto.randomUUID(), (sessionId, text, requestId) => conversations.prompt(sessionId, { requestId, mode: 'queue', content: [{ type: 'text', text }] })))
        } else if (path === '/archive' && request.method === 'POST') {
          const input = await parseJson(request, archiveInputSchema)
          response = json(await archive.run(workspaces.get(input.workspaceId), input.olderThanDays, input.execute))
        } else {
          throw new HttpError(404, 'route_not_found', 'route not found')
        }
        return withCors(response, request)
      } catch (error) {
        return withCors(errorResponse(error), request)
      } finally { if (mutation) inflightWrites-- }
    },
    websocket: {
      backpressureLimit: 8 * 1024 * 1024,
      closeOnBackpressureLimit: true,
      open(socket) {
        events.add(socket as Bun.ServerWebSocket<EventSocketData>)
      },
      message(socket) {
        socket.close(1008, 'event stream is downlink only')
      },
      close(socket) {
        events.remove(socket as Bun.ServerWebSocket<EventSocketData>)
      },
    },
  })

  await runtime.start().catch(error => console.error('Harness Runtime failed to start', error))
  if (runtime.status().state === 'running') conversations.start()
  cron.start()
  const httpUrl = `http://${config.host}:${server.port}`
  const descriptor = connectionDescriptorSchema.parse({
    httpUrl,
    eventsUrl: `ws://${config.host}:${server.port}${API_PREFIX}/events`,
    token,
    instanceId,
    authCookieName,
  })

  return {
    descriptor,
    paths,
    async stop() {
      clearTimeout(quiesceTimer)
      openAICodexAuthorization.dispose()
      await cron.stop()
      watchers.close()
      await commands.stopAll()
      clearInterval(resourceCleanup)
      await resources.close()
      await conversations.stop()
      await runtime.stop()
      server.stop(true)
      if (ownsDatabase) database.close()
    },
  }
}
