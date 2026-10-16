import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { z } from 'zod'
import type { WorkspaceTransport as WorkspaceWorker } from './workers'
import { HttpError } from '../http'

export const pdfInput = z.object({
  outputPath: z.string().min(1).max(32768), title: z.string().max(32768), content: z.string().max(16 * 1024 * 1024),
  sourcePath: z.string().max(32768).optional(), currentDir: z.string().max(32768).optional(),
})
type PdfInput = z.infer<typeof pdfInput>
export const pdfLayout = z.object({ height: z.number().finite().positive().max(20_000_000), complete: z.boolean() })
type PdfLayout = z.infer<typeof pdfLayout>
type Job = { workspaceId: string; payload: PdfInput & { instanceID: string }; ready: (layout: PdfLayout) => void; fail: (error: Error) => void }

async function browserExecutable(): Promise<string> {
  const candidates = [process.env.HULALA_PDF_BROWSER,
    ...(process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : process.platform === 'win32' ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(root => [join(root!, 'Google/Chrome/Application/chrome.exe'), join(root!, 'Microsoft/Edge/Application/msedge.exe')])
        : ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'].map(name => Bun.which(name) || undefined)),
  ].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) if ((await stat(candidate).catch(() => null))?.isFile()) return candidate
  throw new HttpError(503, 'pdf_engine_missing', 'PDF export requires Chrome, Edge, or Chromium. Install one of these browsers, or set HULALA_PDF_BROWSER to its executable.')
}

/** Private pipe to a fresh rendering process; never connects to a user's browser profile. */
class PdfBrowser {
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private sequence = 0
  private buffer = ''
  private finished = false
  readonly process: ChildProcess
  constructor(executable: string, profile: string) {
    this.process = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true })
    ;(this.process.stdio[4] as Readable).setEncoding('utf8').on('data', (chunk: string) => {
      this.buffer += chunk
      if (this.buffer.length > 16 * 1024 * 1024) { this.close(); return }
      for (;;) {
        const end = this.buffer.indexOf('\0')
        if (end < 0) break
        const raw = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1)
        try {
          const response = JSON.parse(raw)
          const request = this.pending.get(response.id)
          if (!request) continue
          this.pending.delete(response.id); clearTimeout(request.timer)
          if (response.error) request.reject(new Error('PDF renderer: ' + response.error.message))
          else request.resolve(response.result)
        } catch { this.close() }
      }
    })
    const failed = () => {
      this.finished = true
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('The PDF rendering process stopped')) }
      this.pending.clear()
    }
    this.process.once('error', failed)
    this.process.once('exit', failed)
  }
  command<T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    if (this.finished) return Promise.reject(new Error('The PDF rendering process stopped'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('PDF rendering timed out')) }, 30000)
      this.pending.set(id, { resolve, reject, timer })
      ;(this.process.stdio[3] as Writable).write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0', error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error) } })
    })
  }
  close(): void { this.process.kill('SIGTERM') }
  async stop(): Promise<void> {
    if (this.finished) return
    const ended = new Promise<void>(resolve => { this.process.once('exit', () => resolve()); this.process.once('error', () => resolve()) })
    this.close()
    const timeout = setTimeout(() => this.process.kill('SIGKILL'), 3000)
    try { await ended } finally { clearTimeout(timeout) }
  }
}

export class PdfExports {
  private readonly jobs = new Map<string, Job>()
  private readonly browsers = new Set<PdfBrowser>()
  private active = 0
  constructor(private readonly root: string) {}
  get(workspaceId: string, id: string): Job {
    const job = this.jobs.get(id)
    if (!job || job.workspaceId !== workspaceId) throw new HttpError(404, 'export_not_found', 'Export job expired')
    return job
  }
  async export(workspaceId: string, worker: WorkspaceWorker, input: PdfInput, origin: string, signal: AbortSignal) {
    if (this.active >= 2) throw new HttpError(429, 'export_busy', 'Two PDF exports are already running. Try again when one finishes.')
    this.active++
    try { return await this.render(workspaceId, worker, input, origin, signal) } finally { this.active-- }
  }
  private async render(workspaceId: string, worker: WorkspaceWorker, input: PdfInput, origin: string, signal: AbortSignal) {
    if (!/\.pdf$/i.test(input.outputPath)) throw new HttpError(400, 'export_path_invalid', 'Choose a .pdf filename')
    const probe = await worker.request('/files/stat?' + new URLSearchParams({ workspaceId: worker.workspace.id, path: input.outputPath }))
    if (probe.ok) throw new HttpError(409, 'file_conflict', 'This PDF already exists. Choose a different filename to preserve it.')
    if (probe.status !== 404) throw new HttpError(403, 'export_path_invalid', 'The PDF destination must be inside the selected Workspace.')
    const executable = await browserExecutable()
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const temporary = await mkdtemp(join(this.root, 'pdf-'))
    const id = crypto.randomUUID()
    const layouts: PdfLayout[] = []
    let waiting: { resolve: (layout: PdfLayout) => void; reject: (error: Error) => void } | undefined
    let failure: Error | undefined
    const fail = (error: Error) => { failure = error; waiting?.reject(error); waiting = undefined }
    const timeout = setTimeout(() => fail(new Error('The document did not finish preparing for PDF export')), 45000)
    const nextLayout = () => {
      if (failure) return Promise.reject(failure)
      if (layouts.length) return Promise.resolve(layouts.shift()!)
      return new Promise<PdfLayout>((resolve, reject) => { waiting = { resolve, reject } })
    }
    this.jobs.set(id, { workspaceId, payload: { ...input, instanceID: worker.descriptor.instanceId }, ready: layout => { if (waiting) { waiting.resolve(layout); waiting = undefined } else layouts.push(layout) }, fail })
    const browser = new PdfBrowser(executable, join(temporary, 'profile'))
    this.browsers.add(browser)
    browser.process.once('exit', () => this.jobs.get(id)?.fail(new Error('The PDF rendering process stopped')))
    browser.process.once('error', () => this.jobs.get(id)?.fail(new Error('The PDF rendering process could not start')))
    const abort = () => { this.jobs.get(id)?.fail(new Error('PDF export cancelled')); browser.close() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      const target = await browser.command<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await browser.command<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      await browser.command('Emulation.setDeviceMetricsOverride', { width: 960, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId)
      await browser.command('Emulation.setEmulatedMedia', { media: 'print' }, sessionId)
      await browser.command('Page.navigate', { url: `${origin}/w/${workspaceId}?view=markdown-pdf-export&job=${id}` }, sessionId)
      let layout = await nextLayout()
      for (let attempt = 0; !layout.complete && attempt < 8; attempt++) {
        if (layout.height > 50_000) throw new HttpError(413, 'pdf_document_too_large', 'This document is too long for one PDF export. Export it in smaller sections.')
        const next = nextLayout()
        await browser.command('Emulation.setDeviceMetricsOverride', { width: 960, height: Math.ceil(layout.height) + 256 + attempt, deviceScaleFactor: 1, mobile: false }, sessionId)
        layout = await next
      }
      if (!layout.complete) throw new Error('The complete document could not be rendered; no PDF was saved')
      clearTimeout(timeout)
      const printed = await browser.command<{ stream: string }>('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, transferMode: 'ReturnAsStream', generateTaggedPDF: true }, sessionId)
      const path = join(temporary, 'document.pdf')
      const file = await open(path, 'wx', 0o600)
      let bytes = 0
      try {
        for (;;) {
          signal.throwIfAborted()
          const chunk = await browser.command<{ data: string; base64Encoded?: boolean; eof: boolean }>('IO.read', { handle: printed.stream, size: 262144 }, sessionId)
          const buffer = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8')
          bytes += buffer.length
          if (bytes > 128 * 1024 * 1024) throw new Error('PDF export exceeds 128 MiB')
          await file.writeFile(buffer)
          if (chunk.eof) break
        }
        await file.sync()
      } finally { await file.close() }
      if (bytes < 5 || (await Bun.file(path).slice(0, 5).text()) !== '%PDF-') throw new Error('The renderer did not produce a valid PDF')
      const query = new URLSearchParams({ workspaceId: worker.workspace.id, path: input.outputPath })
      const response = await worker.request('/resources/import?' + query, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': String(bytes) }, body: Bun.file(path), signal })
      if (!response.ok) { const error = await response.json() as { message?: string; code?: string }; throw new HttpError(response.status, error.code || 'export_failed', error.message || 'Could not save PDF') }
      return { success: true, filePath: input.outputPath, bytes }
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      this.jobs.delete(id)
      await browser.stop()
      this.browsers.delete(browser)
      await rm(temporary, { recursive: true, force: true })
    }
  }
  async stop(): Promise<void> {
    for (const job of this.jobs.values()) job.fail(new Error('The local service stopped'))
    await Promise.all([...this.browsers].map(browser => browser.stop()))
  }
}
