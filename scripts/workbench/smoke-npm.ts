import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

if (!process.argv[2]) throw new Error('Pass the JSON output file from npm-package.ts')
const packages = JSON.parse(await readFile(process.argv[2], 'utf8')) as { meta: string; platform: string; artifacts: string[]; version: string }
const root = await mkdtemp(join(tmpdir(), 'hulala npm 中文 '))
const packagesByVersion: Record<string, any> = {}, archives = new Map<string, string>()
for (const directory of [packages.meta, packages.platform]) {
  const metadata = await Bun.file(join(directory, 'package.json')).json()
  const archive = packages.artifacts.find(file => basename(file) === 'hulala-' + metadata.version + '.tgz')!
  const bytes = await readFile(archive)
  packagesByVersion[metadata.version] = { ...metadata, dist: { tarball: '', integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') } }
  archives.set('/hulala/-/' + metadata.version + '.tgz', archive)
}
const registry = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (archives.has(path)) return new Response(Bun.file(archives.get(path)!))
  if (path === '/hulala') return Response.json({ name: 'hulala', 'dist-tags': { latest: packages.version }, versions: packagesByVersion })
  return Response.json({ error: 'not found' }, { status: 404 })
} })
const registryUrl = `http://127.0.0.1:${registry.port}`
for (const [version, value] of Object.entries(packagesByVersion)) value.dist.tarball = registryUrl + '/hulala/-/' + version + '.tgz'
const ownedPids = new Set<number>()
async function freePort() {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port')
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port
}
async function run(command: string[], env = process.env) {
  const child = Bun.spawn(command, { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
  const output = new Response(child.stdout).text(), errors = new Response(child.stderr).text()
  const code = await child.exited
  const text = (await output) + (await errors)
  if (code) throw new Error(command[0] + ' failed: ' + text.slice(-6000))
  return text
}
async function ready(port: number) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/hulala/health`, { signal: AbortSignal.timeout(500) })
      const value = await response.json() as any
      if (value.name === 'hulala' && value.version === packages.version && value.workbench?.state === 'running') { ownedPids.add(value.pid); return value }
    } catch {}
    await Bun.sleep(100)
  }
  throw new Error('Installed npm service did not become ready')
}
try {
  const prefix = join(root, 'global prefix'), cache = join(root, 'npm-cache')
  await run(['npm', 'install', '-g', '--prefix', prefix, '--cache', cache, '--registry', registryUrl, '--no-audit', '--no-fund', '--ignore-scripts', packages.artifacts[1]!])
  const port = await freePort(), backend = await freePort()
  const globalEnv = { ...process.env, HULALA_HOME: join(root, 'global-state'), HULALA_WORKSPACE_ROOT: join(root, 'global-workspaces'), PI_CODING_AGENT_DIR: join(root, 'global-pi'), HULALA_PORT: String(port), HULALA_WORKBENCH_PORT: String(backend), HULALA_NO_OPEN: '1', HULALA_PACKAGE_ROOT: undefined, HULALA_REPOSITORY_ROOT: undefined }
  // Invoke the installed npm bin, not an entry from this checkout.
  const command = process.platform === 'win32' ? join(prefix, 'hulala.cmd') : join(prefix, 'bin/hulala')
  const version = (await run([command, '--version'], globalEnv)).trim()
  if (version !== packages.version) throw new Error('Installed npm version mismatch')
  await run([command, '--no-open'], globalEnv)
  const health = await ready(port)
  await run([command, '--no-open'], globalEnv)
  if ((await ready(port)).pid !== health.pid) throw new Error('Global npm command started a duplicate service')
  const npxPort = await freePort(), npxBackend = await freePort(), npxCache = join(root, 'npx-cache')
  const npxEnv = { ...globalEnv, HULALA_HOME: join(root, 'npx-state'), HULALA_WORKSPACE_ROOT: join(root, 'npx-workspaces'), PI_CODING_AGENT_DIR: join(root, 'npx-pi'), HULALA_PORT: String(npxPort), HULALA_WORKBENCH_PORT: String(npxBackend) }
  await run(['npm', 'exec', '--yes', '--cache', npxCache, '--registry', registryUrl, '--package', 'hulala@' + packages.version, '--', 'hulala', '--no-open'], npxEnv)
  const npx = await ready(npxPort)
  await rm(npxCache, { recursive: true, force: true })
  if ((await ready(npxPort)).pid !== npx.pid) throw new Error('npx daemon changed after deleting its temporary cache')
  const origin = `http://127.0.0.1:${npxPort}`
  const entry = await fetch(origin, { redirect: 'manual' })
  const cookie = entry.headers.get('set-cookie')!.split(';')[0]!
  const workspace = join(root, 'npx-workspaces', 'After cache deletion')
  await mkdir(workspace, { recursive: true })
  const created = await fetch(origin + '/api/browser/workspaces', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ path: workspace }) })
  if (!created.ok) throw new Error('npx cannot open a new Workspace after cache deletion: ' + await created.text())
  const opened = await created.json() as { id: string }
  const next = await fetch(origin + '/api/browser/workspaces/' + opened.id + '/bootstrap', { headers: { cookie } })
  if (!next.ok || (await next.json() as any).version !== packages.version) throw new Error('npx could not launch a fresh Host after cache deletion')
  console.log(JSON.stringify({ globalNpmInstall: true, version, sourceIsPackagedTarball: true, globalCommandReusesService: true,
    freshNpxCache: true, deletedNpxCacheWhileRunning: true, newWorkspaceAfterCacheDeletion: true }))
} finally {
  registry.stop(true)
  for (const pid of ownedPids) try { process.kill(pid, 'SIGTERM') } catch {}
  await Bun.sleep(1000)
  await rm(root, { recursive: true, force: true })
}
