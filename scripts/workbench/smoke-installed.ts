import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyPackage } from './package-manifest'

const directory = resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('Pass an installed Hulala package directory')
const manifest = await verifyPackage(directory)
const root = await mkdtemp(join(tmpdir(), 'hulala installed 中文 '))
async function port(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}
const publicPort = await port(), backendPort = await port()
const testBin = join(root, 'test-bin'); await mkdir(testBin)
const opener = join(testBin, process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open')
const probeBuild = Bun.spawn([process.execPath, 'build', join(import.meta.dir, '../../apps/cli/tests/fixtures/browser-opener.ts'), '--compile', '--minify', '--outfile', opener], { stdout: 'ignore', stderr: 'pipe' })
if (await probeBuild.exited !== 0) throw new Error(await new Response(probeBuild.stderr).text())
const browserLog = join(root, 'browser-open.json')
const environment = { ...process.env, PATH: process.platform === 'win32' ? testBin + ';' + process.env.SystemRoot + '\\System32' : testBin + ':/usr/bin:/bin',
  HULALA_HOME: join(root, 'state'), HULALA_WORKSPACE_ROOT: join(root, 'workspaces'), PI_CODING_AGENT_DIR: join(root, 'pi'),
  HULALA_PORT: String(publicPort), HULALA_WORKBENCH_PORT: String(backendPort), HULALA_REPOSITORY_ROOT: undefined,
  HULALA_PACKAGE_ROOT: undefined, HULALA_NO_OPEN: undefined, HULALA_BROWSER: opener, HULALA_TEST_BROWSER_LOG: browserLog }
const executable = join(directory, manifest.entrypoint)
const start = performance.now()
const child = Bun.spawn([executable, '--foreground'], { cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe' })
const stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text()
const origin = `http://127.0.0.1:${publicPort}`
try {
  let ready: any
  const deadline = Date.now() + 40000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Installed launcher exited: ${await stderr}`)
    try {
      const response = await fetch(origin + '/api/hulala/health', { signal: AbortSignal.timeout(500) })
      const value = await response.json() as any
      if (response.ok && value.version === manifest.version && value.workbench?.state === 'running') { ready = value; break }
    } catch {}
    await Bun.sleep(100)
  }
  if (!ready) throw new Error('Installed browser workbench did not become ready')
  const coldStartMs = Math.round(performance.now() - start)
  const openDeadline = Date.now() + 5000
  while (!await Bun.file(browserLog).exists() && Date.now() < openDeadline) await Bun.sleep(50)
  const opened = await Bun.file(browserLog).json()
  if (!opened.ready || opened.version !== manifest.version || opened.url !== `http://hulala.localhost:${publicPort}/`) throw new Error('Browser opened before matching workbench readiness')
  const entry = await fetch(origin, { redirect: 'manual' })
  const cookie = entry.headers.get('set-cookie')?.split(';')[0]
  if (!cookie || entry.status !== 302) throw new Error('No browser entry session')
  const location = entry.headers.get('location')!
  const page = await fetch(new URL(location, origin), { headers: { cookie } })
  const html = await page.text()
  if (!page.ok || !html.includes('<title>Hulala</title>')) throw new Error('Packaged UI did not load')
  const script = html.match(/src="([^"]+\.js)"/)?.[1]
  if (!script || !(await fetch(new URL(script, origin), { headers: { cookie } })).ok) throw new Error('Packaged UI assets unavailable')
  const prefix = '/api/browser/workspaces/' + location.split('/')[2]
  const bootstrap = await (await fetch(origin + prefix + '/bootstrap', { headers: { cookie } })).json() as any
  if (bootstrap.version !== manifest.version || !bootstrap.workspace.path.includes('hulala installed')) throw new Error('Installed Host version or paths are wrong')
  const plugins = await fetch(origin + prefix + '/api/harness/plugins', { headers: { cookie } })
  if (!plugins.ok) throw new Error('Packaged Harness plugin inventory is unavailable')
  const conversation = await fetch(origin + prefix + '/api/conversations/open', {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'workspace', workspaceId: bootstrap.nativeWorkspace.id }),
  })
  const openedConversation = await conversation.json() as any
  if (!conversation.ok || typeof openedConversation.snapshot?.session?.sessionId !== 'string') throw new Error('The installed default Agent could not open a conversation: ' + JSON.stringify(openedConversation))
  const runtime = join(directory, 'runtime')
  const imports = Bun.spawn([join(runtime, 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun'), '-e',
    'for (const entry of process.argv.slice(1)) await import(entry)',
    ...['pi', 'codex', 'claude'].map(name => pathToFileURL(join(runtime, 'packages', 'agent-loop-' + name, 'lib/index.js')).href),
  ], { cwd: root, env: { ...environment, HOME: root, USERPROFILE: root, HULALA_RUNTIME_REPOSITORY_ROOT: runtime }, stdout: 'ignore', stderr: 'pipe' })
  const importErrors = new Response(imports.stderr).text()
  if (await imports.exited !== 0) throw new Error('Installed SDK plugin import failed: ' + (await importErrors).slice(-3000))
  await writeFile(join(bootstrap.workspace.path, 'packaged-search.txt'), 'BUNDLED_RIPGREP_OK\n')
  const search = await fetch(origin + prefix + '/api/files/search?' + new URLSearchParams({ workspaceId: bootstrap.nativeWorkspace.id, path: '.', query: 'BUNDLED_RIPGREP_OK' }), { headers: { cookie } })
  if (!search.ok || !(await search.json() as any).items.some((item: any) => item.text.includes('BUNDLED_RIPGREP_OK'))) throw new Error('Packaged ripgrep search failed')
  const text = await readFile(join(root, 'workspaces/workspace/AGENTS.md'), 'utf8')
  if (!text) throw new Error('Installed default Workspace was not initialized')
  const repeat = Bun.spawn([executable, '--no-open'], { cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe' })
  if (await repeat.exited !== 0) throw new Error(await new Response(repeat.stderr).text())
  const reused = await (await fetch(origin + '/api/hulala/health')).json() as any
  if (ready.pid !== reused.pid || ready.workbench.pid !== reused.workbench.pid) throw new Error('Duplicate launch did not reuse the service')
  console.log(JSON.stringify({ installed: true, version: manifest.version, target: manifest.target, coldStartMs,
    runtimeWithoutNodeOrBunOnPath: true, arbitraryUnicodeCwd: true, repeatReusesHost: true, bundledSearch: true, sdkPluginImports: true, defaultAgentSession: true, browserOpensOnlyWhenReady: true }))
} finally {
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000)
  await child.exited; clearTimeout(timer)
  const output = (await stdout) + (await stderr)
  if (child.exitCode && output) console.error(output.slice(-4000))
  await rm(root, { recursive: true, force: true })
}
