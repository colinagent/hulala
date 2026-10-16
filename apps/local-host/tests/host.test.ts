import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CONNECTION_TOKEN_HEADER } from '@hulala/workbench-contracts'
import { ensureHulalaPaths } from '../src/config.ts'
import { createDesktopHost, type DesktopHostHandle } from '../src/host.ts'
import { desktopTransportPlugin } from '../src/plugins/desktopTransport.ts'
import { harnessFoundationPlugin } from '../src/plugins/harnessFoundation.ts'
import { productDatabasePlugin } from '../src/plugins/productDatabase.ts'
import { fakeNativeServices, unavailableSubprocess } from './harness-fixture.ts'
import { HarnessApiAdapter } from '../src/runtime.ts'
import { createHarnessNotifications } from '../src/harnessNotifications.ts'
import { pathToFileURL } from 'node:url'
import { createAssistantMessage, expandAssistantStream, LlmAttemptId, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm'

const contexts: Context[] = []
const hosts: DesktopHostHandle[] = []
const roots: string[] = []
let previousPiDirectory: string | undefined

beforeEach(async () => {
  previousPiDirectory = process.env.PI_CODING_AGENT_DIR
  const directory = await mkdtemp(join(tmpdir(), 'hulala-test-pi-'))
  roots.push(directory)
  process.env.PI_CODING_AGENT_DIR = directory
})

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop()))
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  if (previousPiDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = previousPiDirectory
})

test('Cordis owns the authenticated Desktop transport lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-host-plugin-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  const native = fakeNativeServices()
  ctx.provide('workspaceRegistry', native.workspaceRegistry)
  ctx.provide('fs', native.fs)
  ctx.provide('subprocess', unavailableSubprocess())
  await ctx.plugin(productDatabasePlugin, {
    paths: await ensureHulalaPaths(root, join(root, 'workspaces')),
    retention: {
      cronRunDays: 90,
      cronRunMaxPerJob: 200,
      archivedMessageDays: 90,
      archiveRunMaxPerWorkspace: 200,
    },
  })
  const fiber = await ctx.plugin(desktopTransportPlugin, {
    host: '127.0.0.1',
    port: 0,
    hulalaRoot: root,
    workspaceRoot: join(root, 'workspaces'),
    version: 'test',
  })
  const transport = ctx.get('hulalaDesktopTransport')
  expect(transport).toBeDefined()
  const response = await fetch(`${transport!.descriptor.httpUrl}/api/desktop/v1/health`, {
    headers: { [CONNECTION_TOKEN_HEADER]: transport!.descriptor.token },
  })
  expect(response.status).toBe(200)

  await fiber.dispose()
  expect(ctx.get('hulalaDesktopTransport')).toBeUndefined()
  await expect(fetch(`${transport!.descriptor.httpUrl}/api/desktop/v1/health`)).rejects.toThrow()
})

test('private plugins can inject and release an upstream Harness service', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(harnessFoundationPlugin)
  let observed = false
  const consumer = await ctx.plugin({
    name: 'hulala-session-probe',
    inject: ['sessions'],
    apply(inner: Context) {
      observed = inner.sessions.list().length === 0
    },
  })
  expect(observed).toBeTrue()
  expect(ctx.get('sessions')).toBeDefined()

  await consumer.dispose()
  await ctx.fiber.dispose()
  expect(ctx.get('sessions')).toBeUndefined()
})

test('boots the public Harness and private transport in one Host process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-single-host-'))
  roots.push(root)
  const publicRepository = process.env.HULALA_PUBLIC_REPOSITORY
    ?? join(import.meta.dir, '..', '..', '..')
  const host = await createDesktopHost({
    host: '127.0.0.1',
    port: 0,
    hulalaRoot: root,
    workspaceRoot: join(root, 'workspaces'),
    runtimeHostModule: join(publicRepository, 'packages', 'runtime', 'src', 'in-process.ts'),
    runtimeRepositoryRoot: publicRepository,
    version: 'test',
  })
  hosts.push(host)
  const response = await fetch(`${host.descriptor.httpUrl}/api/desktop/v1/health`, {
    headers: { [CONNECTION_TOKEN_HEADER]: host.descriptor.token },
  })
  expect(response.status).toBe(200)
  expect((await response.json() as { runtime?: { state?: unknown } }).runtime?.state).toBe('running')

  const providerAuth = await fetch(`${host.descriptor.httpUrl}/api/desktop/v1/harness/provider-auth/openai-codex`, {
    headers: { [CONNECTION_TOKEN_HEADER]: host.descriptor.token },
  })
  expect(providerAuth.status).toBe(200)
  expect(await providerAuth.json()).toMatchObject({
    available: true,
    configured: false,
    providerReady: false,
    methods: [{ id: 'oauth' }],
  })

  const headers = {
    [CONNECTION_TOKEN_HEADER]: host.descriptor.token,
    'content-type': 'application/json',
  }
  const workspaces = await (await fetch(`${host.descriptor.httpUrl}/api/desktop/v1/workspaces`, { headers }))
    .json() as { items: Array<{ id: string; path: string }> }
  const workspaceId = workspaces.items[0]!.id
  const written = await fetch(`${host.descriptor.httpUrl}/api/desktop/v1/files/text`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ workspaceId, path: 'native-fs.txt', content: 'native fs', expectedVersion: null }),
  })
  expect(written.status).toBe(200)
  const read = await fetch(
    `${host.descriptor.httpUrl}/api/desktop/v1/files/text?workspaceId=${encodeURIComponent(workspaceId)}&path=native-fs.txt`,
    { headers },
  )
  expect((await read.json() as { content?: unknown }).content).toBe('native fs')
  const command = await fetch(`${host.descriptor.httpUrl}/api/desktop/v1/commands`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ workspaceId, command: [process.execPath, '--version'] }),
  })
  expect(command.status).toBe(201)
  const initialized = Bun.spawnSync(['git', 'init'], { cwd: workspaces.items[0]!.path })
  expect(initialized.exitCode).toBe(0)
  const git = await fetch(
    `${host.descriptor.httpUrl}/api/desktop/v1/git/status?workspaceId=${encodeURIComponent(workspaceId)}`,
    { headers },
  )
  expect(git.status).toBe(200)
  const opened = await fetch(`${host.descriptor.httpUrl}/api/desktop/v1/conversations/open`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'workspace', workspaceId }),
  })
  const openedPayload = await opened.json() as {
    code?: unknown
    message?: unknown
    snapshot?: { session?: { sessionId?: unknown } }
  }
  if (!opened.ok) throw new Error(`conversation open failed: ${JSON.stringify(openedPayload)}`)
  expect(openedPayload.snapshot?.session?.sessionId)
    .toBeString()
}, 30_000)

test('Harness 0.1.5 Remote services preserve settings, history, and native approval answers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-harness-upgrade-'))
  roots.push(root)
  const publicRepository = process.env.HULALA_PUBLIC_REPOSITORY
    ?? join(import.meta.dir, '..', '..', '..')
  const module = await import(pathToFileURL(join(publicRepository, 'packages/runtime/src/in-process.ts')).href)
  const runtime = await module.bootRepositoryHarness({ repositoryRoot: publicRepository, paths: { root }, environment: { DSH_TELEMETRY_DISABLED: '1' } })
  const ctx = runtime.ctx as Context
  const notifications = createHarnessNotifications(ctx)
  const harness = new HarnessApiAdapter({ typertGateway: ctx.typertGateway, notifications, sessions: ctx.sessions, sessionPersistence: ctx.sessionPersistence, agentPresets: ctx.agentPresets, settings: ctx.settings })
  const abort = new AbortController()
  try {
    const workspace = await harness.createWorkspace(root)
    const created = await harness.createSession({ workspaceId: workspace.workspace.workspaceId })
    const sessionId = created.sessionId
    expect((await harness.history(sessionId)).events.length).toBeGreaterThan(0)
    expect((await harness.models(sessionId)).current.model).toBeString()
    expect(await harness.listSkills(sessionId)).toHaveProperty('skills')
    expect(await harness.listCommands(sessionId)).toBeDefined()
    expect(await harness.listSubagents(sessionId)).toHaveProperty('entries')
    expect(await harness.agentPresetList()).toMatchObject({ hasDocument: true })
    expect(await harness.agentPresetRead({ agentPreset: 'standard' })).toHaveProperty('content')
    await expect(harness.agentPresetOpenDocument({ agentPreset: 'standard' })).rejects.toThrow('read-only')
    await harness.agentPresetCopy({ from: 'standard', agentPreset: 'browser-edit-test' })
    const presetDocument = await harness.agentPresetOpenDocument({ agentPreset: 'browser-edit-test' })
    expect(presetDocument.directory).toStartWith(root)
    expect(await Bun.file(presetDocument.path).exists()).toBeTrue()
    const settingsDocument = await harness.settingsOpenDocument()
    expect(settingsDocument.directory).toStartWith(root)
    expect(await Bun.file(settingsDocument.path).exists()).toBeTrue()
    expect(await harness.selectAgentPreset(sessionId, 'standard')).toEqual({ agentPreset: 'standard' })
    expect(await harness.llmProviders()).toHaveProperty('providers')
    const ref = 'HULALA_UPGRADE_TEST_KEY'
    await harness.credentialsSet({ ref, value: 'test-only-secret' })
    const state = await harness.credentialsDescribe({ refs: [ref] })
    expect(state).toMatchObject({ credentials: { [ref]: { configured: true } } })
    expect(JSON.stringify(state)).not.toContain('test-only-secret')
    await harness.credentialsUnset({ ref })

    const description = await harness.settingsDescribe() as { namespaces: Array<{ ns: string; revision: number }> }
    const network = description.namespaces.find(item => item.ns === 'hulala-network')!
    await harness.settingsMutate({ ns: network.ns, expectedRevision: network.revision, ops: [{ op: 'set', path: ['mode'], value: 'off' }] })

    const frames: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
    const pump = (async () => { for await (const frame of notifications.events('mux', abort.signal, () => {})) frames.push(frame) })()
    const agent = ctx.get('agents')!.get(sessionId as never)!
    agent.session.append('turn/start', { turn: 1 })
    const decision = ctx.approval.request({ agent, toolName: 'test-tool', reason: 'integration test', signal: abort.signal })
    const deadline = Date.now() + 2_000
    while (!frames.some(frame => frame.payload.type === 'approval/requested') && Date.now() < deadline) await Bun.sleep(5)
    const request = frames.find(frame => frame.payload.type === 'approval/requested')!
    expect(request).toBeDefined()
    expect(await harness.respond(request.rpcId, { ok: true, value: { outcome: 'allowed-once' } })).toEqual({ accepted: true })
    expect(await decision).toBe('allowed-once')
    expect(await harness.respond(request.rpcId, { ok: true, value: {} })).toMatchObject({ accepted: false })
    agent.session.append('step/start', { turn: 1, step: 1 })
    const stream: AssistantStreamRecord[] = [{ type: 'text-chunks', time0: Date.now(), index: 0, dt: [1, 2], texts: ['hello', ' ', 'world'] }]
    const attemptId = LlmAttemptId('upgrade-test-attempt')
    ctx.emit('agent/assistant-stream', { agent, frame: { type: 'start', attemptId, revision: 1, turn: 1, step: 1 } })
    expandAssistantStream(stream).forEach(({ time, chunk }, index) => {
      ctx.emit('agent/assistant-stream', { agent, frame: { type: 'chunk', attemptId, revision: index + 2, index, time, chunk } })
    })
    agent.session.append('assistant/message', {
      turn: 1, step: 1, stream,
      message: createAssistantMessage({ source: { provider: 'test', model: 'test' }, content: [{ type: 'text', text: 'hello world' }] }),
    }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })
    const streamDeadline = Date.now() + 2_000
    while (frames.filter(frame => frame.payload.type === 'session/assistant-stream').length < 4 && Date.now() < streamDeadline) await Bun.sleep(5)
    abort.abort()
    await pump

    const history = await harness.history(sessionId)
    expect(history.events.some(entry => entry.event.type === 'approval/decided')).toBeTrue()
    const assistant = history.events.find(entry => entry.event.type === 'assistant/message')!
    expect(expandAssistantStream((assistant.event.data as { stream: AssistantStreamRecord[] }).stream).map(entry => entry.chunk)).toMatchObject([
      { type: 'text-delta', text: 'hello' }, { type: 'text-delta', text: ' ' }, { type: 'text-delta', text: 'world' },
    ])
    expect(frames.filter(frame => frame.payload.type === 'session/assistant-stream')).toHaveLength(4)
    expect(await harness.sessionLocation(sessionId)).toHaveProperty('path')
    await harness.archiveSession(sessionId)
    expect((await harness.listWorkspaces()).archivedSessionIds).toContain(sessionId)
  } finally {
    abort.abort()
    await runtime.stop()
  }
}, 15_000)
