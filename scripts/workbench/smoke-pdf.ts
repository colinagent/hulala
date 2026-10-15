import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startBrowserServer } from '../../apps/local-host/src/browser/server'

const root = await mkdtemp(join(tmpdir(), 'hulala-pdf-smoke-'))
const repositoryRoot = join(import.meta.dir, '../..')
const previousPi = process.env.PI_CODING_AGENT_DIR
process.env.PI_CODING_AGENT_DIR = join(root, 'pi')
const handle = await startBrowserServer({ repositoryRoot, hulalaRoot: join(root, 'state'), workspaceRoot: join(root, 'workspaces'), version: 'test', port: 0, publicPort: 0, webDirectory: process.env.HULALA_WEB_OUTPUT || join(repositoryRoot, 'apps/workbench/dist'), settingsDirectory: join(repositoryRoot, 'apps/workbench/settings') })
try {
  const origin = `http://127.0.0.1:${handle.server.port}`
  const page = await fetch(origin, { redirect: 'manual' })
  const cookie = page.headers.get('set-cookie')!.split(';')[0]!
  const workspaceId = page.headers.get('location')!.split('/')[2]!
  const prefix = origin + '/api/browser/workspaces/' + workspaceId
  const bootstrap = await (await fetch(prefix + '/bootstrap', { headers: { cookie } })).json() as any
  const workspace = bootstrap.workspace.path as string
  await writeFile(join(workspace, 'fixture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="#e6f1f1"/><circle cx="40" cy="40" r="24" fill="#247979"/><text x="76" y="45" fill="#222">Image QA</text></svg>')
  const input = {
    outputPath: join(workspace, '中文 PDF QA.pdf'), title: '中文 PDF QA', sourcePath: join(workspace, '中文 PDF QA.md'), currentDir: workspace,
    content: '# 中文导出验证 · PDF QA\n\n这是一份自动生成的测试文档。English text and 中文内容。\n\n$$E = mc^2$$\n\n```mermaid\nflowchart LR\n  A[Input] --> B[Render] --> C[PDF]\n```\n\n![Image QA](fixture.svg)\n\n| 项目 | 结果 |\n| --- | --- |\n| 中文 | 保留 |\n| Image | Visible |\n\n' + Array.from({ length: 50 }, (_, index) => `段落 ${index + 1}：用于验证分页、字体和正文完整性。The exported PDF must preserve this paragraph.\n\n`).join(''),
  }
  await writeFile(input.sourcePath, input.content)
  const post = (url: string, value: unknown, method = 'POST') => fetch(url, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(value) })
  const draft = { version: 1, workspaceTabId: crypto.randomUUID(), id: 'untouched', editorId: 'markdown', title: 'Independent draft', content: 'Draft must survive export', contentVersion: 1 }
  if (!(await post(prefix + '/drafts', draft, 'PUT')).ok) throw new Error('Could not prepare draft isolation check')
  const draftRoot = join(root, 'state/server/browser/drafts', workspaceId)
  const before = await readdir(draftRoot)
  const result = await post(prefix + '/exports', input)
  const exported = await result.json() as any
  if (!result.ok) throw new Error(JSON.stringify(exported))
  const pdf = Bun.file(input.outputPath)
  if (!(await pdf.slice(0, 5).text()).startsWith('%PDF-') || pdf.size < 10000) throw new Error('PDF artifact is missing or incomplete')
  const after = await readdir(draftRoot)
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Export changed draft ownership')
  const retained = JSON.parse(await Bun.file(join(draftRoot, before[0]!)).text())
  if (retained.workspaceTabId !== draft.workspaceTabId || retained.content !== draft.content) throw new Error('Export consumed a draft')
  const collision = await post(prefix + '/exports', input)
  if (collision.status !== 409) throw new Error('Export did not protect an existing PDF')
  await mkdir(join(root, 'evidence'), { recursive: true })
  await writeFile(join(root, 'evidence/result.json'), JSON.stringify({ bytes: pdf.size, draftUnchanged: true, collisionRejected: true }))
  console.log(JSON.stringify({ root, file: input.outputPath, bytes: pdf.size, draftUnchanged: true, collisionRejected: true }))
} finally {
  await handle.stop()
  if (previousPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousPi
  if (!process.argv.includes('--keep')) await rm(root, { recursive: true, force: true })
}
