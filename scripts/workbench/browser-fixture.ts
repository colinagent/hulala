import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { startBrowserServer } from '../../apps/local-host/src/browser/server'

const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
if (!argument('--root')) throw new Error('Browser fixtures require an explicit isolated root')
const root = resolve(argument('--root')!), repositoryRoot = join(import.meta.dir, '../..')
const key = 'synthetic-browser-model-key'
let requests = 0
const frame = (text: string, finish: string | null = null) => 'data: ' + JSON.stringify({ id: 'browser-fixture', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: finish }], ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } : {}) }) + '\n\n'
const timers = new Set<ReturnType<typeof setInterval>>()
const model = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  if (!new URL(request.url).pathname.endsWith('/chat/completions')) return Response.json({ requests })
  if (request.headers.get('authorization') !== 'Bearer ' + key) return new Response('Fixture authentication failed', { status: 401 })
  requests++
  const body = await request.json() as { stream?: boolean; messages?: unknown[] }
  if (body.stream === false) return Response.json({ id: 'fixture', model: 'deepseek-flash', choices: [{ index: 0, message: { role: 'assistant', content: 'Browser fixture reply' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setInterval> | undefined
  const clear = () => { clearInterval(timer); if (timer) timers.delete(timer) }
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    const pieces = ['Browser ', 'fixture ', 'reply', '.']
    timer = setInterval(() => {
      try {
        const piece = pieces.shift()
        if (piece !== undefined) controller.enqueue(encoder.encode(frame(piece)))
        else { controller.enqueue(encoder.encode(frame('', 'stop') + 'data: [DONE]\n\n')); controller.close(); clear() }
      } catch { clear() }
    }, 150)
    timers.add(timer)
    request.signal.addEventListener('abort', clear, { once: true })
  }, cancel: clear }), { headers: { 'content-type': 'text/event-stream' } })
} })
process.env.PI_CODING_AGENT_DIR = join(root, 'pi')
process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${model.port}`
process.env.DEEPSEEK_API_KEY = key
process.env.HULALA_INSTALL_SOURCE = 'source'
delete process.env.HULALA_INSTALL_ROOT
const workspaces = join(root, 'workspaces'), workspace = join(workspaces, 'workspace'), second = join(workspaces, '项目 B')
await mkdir(workspace, { recursive: true }); await mkdir(second, { recursive: true })
await writeFile(join(workspace, 'Browser QA.md'), '# Browser QA\n\nOriginal content.\n')
await writeFile(join(second, 'Second.md'), '# Second Workspace\n')
const handle = await startBrowserServer({ repositoryRoot, hulalaRoot: join(root, 'state'), workspaceRoot: workspaces, version: '0.1.4', port: 0, publicPort: 0,
  webDirectory: resolve(argument('--web') || join(repositoryRoot, 'apps/workbench/dist')), settingsDirectory: join(repositoryRoot, 'apps/workbench/settings') })
const first = handle.registry.list()[0]!, worker = await handle.workers.get(first)
const selected = await worker.request('/harness/runtime-selection', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runtime: 'deepseek' }) })
if (!selected.ok) throw new Error('Could not select the fixture Runtime')
console.log(JSON.stringify({ url: `http://hulala.localhost:${handle.server.port}`, root, workspace, second, workspaceId: first.id }))
let stopping = false
const stop = async () => { if (stopping) return; stopping = true; for (const timer of timers) clearInterval(timer); await handle.stop(); model.stop(true); process.exit(0) }
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop())
