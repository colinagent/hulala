import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDesktopHost, type DesktopHostHandle } from '../src/host'

test('real Harness executes and cancels background Cron turns against an isolated local model fixture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-cron-native-'))
  const previous = new Map(['PI_CODING_AGENT_DIR', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_API_KEY'].map(name => [name, process.env[name]]))
  let requests = 0, hold = false, stage = 'setup'
  const observed: unknown[] = []
  const controllers = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const timers = new Set<ReturnType<typeof setInterval>>()
  const encoder = new TextEncoder()
  const frame = (content: string, finish: string | null = null) => 'data: ' + JSON.stringify({ id: 'synthetic-completion', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: finish }], ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } } : {}) }) + '\n\n'
  const model = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (!new URL(request.url).pathname.endsWith('/chat/completions')) return new Response('Fixture route not found', { status: 404 })
    if (request.headers.get('authorization') !== 'Bearer test-only-cron-key') return new Response('Fixture authorization mismatch', { status: 401 })
    const body = await request.json() as { messages?: Array<{ content?: unknown }>; tools?: unknown[]; model?: string }
    const auxiliary = JSON.stringify(body.messages?.[0]?.content || '').includes('Create a concise title for an AI coding-assistant session')
    if (!auxiliary) requests++
    observed.push({ auxiliary, model: body.model, tools: body.tools?.length, first: JSON.stringify(body.messages?.[0]?.content).slice(0, 100) })
    if (!hold || auxiliary) return new Response(frame('Native ') + frame('Cron QA', 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    let timer: ReturnType<typeof setInterval> | undefined
    const clear = () => { clearInterval(timer); if (timer) timers.delete(timer) }
    return new Response(new ReadableStream({ start(controller) {
      controllers.add(controller)
      controller.enqueue(encoder.encode(frame('Waiting for cancellation')))
      timer = setInterval(() => { try { controller.enqueue(encoder.encode(': fixture heartbeat\n\n')) } catch { clear() } }, 100)
      timers.add(timer)
      request.signal.addEventListener('abort', () => { clear(); try { controller.close() } catch {} }, { once: true })
    }, cancel: clear }), { headers: { 'content-type': 'text/event-stream' } })
  } })
  let host: DesktopHostHandle | undefined
  try {
    process.env.PI_CODING_AGENT_DIR = join(root, 'pi')
    process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${model.port}`
    process.env.DEEPSEEK_API_KEY = 'test-only-cron-key'
    const repositoryRoot = join(import.meta.dir, '../../..')
    host = await createDesktopHost({ host: '127.0.0.1', port: 0, hulalaRoot: join(root, 'state'), workspaceRoot: join(root, 'workspaces'), version: 'test', runtimeHostModule: join(repositoryRoot, 'packages/runtime/lib/in-process.js'), runtimeRepositoryRoot: repositoryRoot })
    const headers = { 'x-hulala-token': host.descriptor.token, 'content-type': 'application/json' }
    const api = async (path: string, input?: unknown) => {
      const response = await fetch(host!.descriptor.httpUrl + '/api/desktop/v1' + path, { headers, signal: AbortSignal.timeout(5000), ...(input === undefined ? {} : { method: 'POST', body: JSON.stringify(input) }) })
      const value = await response.json() as any
      if (!response.ok) throw new Error('Fixture API failed: ' + JSON.stringify(value))
      return value
    }
    await api('/harness/runtime-selection', { runtime: 'deepseek' })
    const workspace = (await api('/workspaces')).items[0]
    const job = await api('/cron', { name: 'Synthetic native turn', workspaceId: workspace.id, schedule: { every: '1d' }, prompt: 'Return the fixture response.', enabled: false, modelKey: 'deepseek-official:deepseek-flash' })
    const requestId = crypto.randomUUID()
    const [first, repeated] = await Promise.all([api('/cron/' + job.id + '/run', { requestId }), api('/cron/' + job.id + '/run', { requestId })])
    expect(first).toEqual(repeated)
    const waitFor = async (predicate: () => Promise<boolean>) => {
      const deadline = Date.now() + 10000
      while (!await predicate()) { if (Date.now() > deadline) throw new Error('Native fixture timed out'); await Bun.sleep(25) }
    }
    await waitFor(async () => (await api('/cron/' + job.id + '/history')).items.some((run: any) => run.runID === first.runId && run.status === 'completed'))
    expect(requests).toBe(1)
    const history = await api('/conversations/' + first.sessionId + '/history')
    expect(JSON.stringify(history.items)).toContain('Native Cron QA')
    expect((await api('/messages')).items).toHaveLength(1)
    expect(await api('/cron/' + job.id + '/run', { requestId })).toEqual(first)
    expect(requests).toBe(1)

    stage = 'second-run'; hold = true
    const second = await api('/cron/' + job.id + '/run', { requestId: crypto.randomUUID() })
    stage = 'wait-second-request'; await waitFor(async () => requests === 2)
    stage = 'cancel'; await api('/conversations/' + second.sessionId + '/cancel', {})
    stage = 'wait-stopped'; await waitFor(async () => (await api('/cron/' + job.id + '/history')).items.some((run: any) => run.runID === second.runId && run.status === 'stopped'))
    expect((await api('/messages')).items).toHaveLength(2)
    stage = 'shutdown-active-turn'
    await api('/cron/' + job.id + '/run', { requestId: crypto.randomUUID() })
    await waitFor(async () => requests === 3)
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([host.stop(), new Promise<never>((_, reject) => { shutdownTimer = setTimeout(() => reject(new Error('Host did not stop its active model stream')), 5000) })])
      host = undefined
    } finally { clearTimeout(shutdownTimer) }
  } catch (error) { console.error(JSON.stringify({ stage, requests, observed, error: String(error) })); throw error } finally {
    for (const controller of controllers) { try { controller.close() } catch {} }
    for (const timer of timers) clearInterval(timer)
    model.stop(true)
    await host?.stop()
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
