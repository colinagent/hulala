import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'
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
// A small authored EPUB exercises real iframe pagination without user books.
await writeFile(join(workspace, 'Reader QA.epub'), zipSync({
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8('<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
  'book.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">hulala-reader-qa</dc:identifier><dc:title>Reader QA</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' + [1, 2, 3].map(n => `<item id="chapter${n}" href="chapter${n}.xhtml" media-type="application/xhtml+xml"/>`).join('') + '</manifest><spine>' + [1, 2, 3].map(n => `<itemref idref="chapter${n}"/>`).join('') + '</spine></package>'),
  'nav.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>' + [1, 2, 3].map(n => `<li><a href="chapter${n}.xhtml">Chapter ${n}</a></li>`).join('') + '</ol></nav></body></html>'),
  ...Object.fromEntries([1, 2, 3].map(n => {
    const footnote = n === 2
      ? '<a href="#note" epub:type="noteref">Footnote test</a><aside id="note" epub:type="footnote">' + '<p>A long footnote retains its own native scroll area.</p>'.repeat(40) + '</aside>'
      : ''
    return [`chapter${n}.xhtml`, strToU8(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Chapter ${n}</title><script>parent.__hulalaEpubScriptRan = true</script><script src="/epub-fixture-script.js"></script></head><body onload="parent.__hulalaEpubScriptRan = true"><h1>Chapter ${n}</h1><p>Reader pagination fixture. Each gesture should turn the book without moving the workbench.</p>${footnote}</body></html>`)]
  })),
}))
const handle = await startBrowserServer({ repositoryRoot, hulalaRoot: join(root, 'state'), workspaceRoot: workspaces, version: '0.1.4', port: 0, publicPort: 0,
  webDirectory: resolve(argument('--web') || join(repositoryRoot, 'apps/workbench/dist')), settingsDirectory: join(repositoryRoot, 'apps/workbench/settings') })
const first = handle.registry.list()[0]!, worker = await handle.workers.get(first)
const selected = await worker.request('/harness/runtime-selection', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runtime: 'deepseek' }) })
if (!selected.ok) throw new Error('Could not select the fixture Runtime')
console.log(JSON.stringify({ url: `http://hulala.localhost:${handle.server.port}`, root, workspace, second, workspaceId: first.id }))
let stopping = false
const stop = async () => { if (stopping) return; stopping = true; for (const timer of timers) clearInterval(timer); await handle.stop(); model.stop(true); process.exit(0) }
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop())
