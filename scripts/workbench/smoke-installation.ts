import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verifyPackage } from './package-manifest'
import { availablePort } from '../../apps/cli/src/distribution/validate'
import { fileSha256 } from '@hulala/distribution/archive'

if (!process.argv[2]) throw new Error('Pass a full native package')
const source = resolve(process.argv[2]), manifest = await verifyPackage(source)
const temporary = await mkdtemp(join(tmpdir(), 'hulala installed lifecycle 中文 '))
const state = join(temporary, 'user state'), workspaces = join(temporary, 'projects'), root = join(temporary, 'program versions'), bin = join(temporary, 'command bin')
const executable = join(source, manifest.entrypoint), installed = join(bin, process.platform === 'win32' ? 'hulala.exe' : 'hulala')
const port = await availablePort(), backend = await availablePort(), origin = `http://127.0.0.1:${port}`
const env = { ...process.env, HULALA_HOME: state, HULALA_WORKSPACE_ROOT: workspaces, PI_CODING_AGENT_DIR: join(temporary, 'pi'), HULALA_NO_OPEN: '1', HULALA_PORT: String(port), HULALA_WORKBENCH_PORT: String(backend), HULALA_INSTALL_ROOT: undefined, HULALA_PACKAGE_ROOT: undefined, HULALA_REPOSITORY_ROOT: undefined }
const run = async (entry: string, args: string[], success = true) => {
  const child = Bun.spawn([entry, ...args], { cwd: temporary, env, stdout: 'pipe', stderr: 'pipe' })
  const output = new Response(child.stdout).text(), error = new Response(child.stderr).text(), code = await child.exited
  const text = (await output) + (await error)
  if (success && code !== 0) throw new Error(`Installed command failed (${code}): ${text.slice(-5000)}`)
  if (!success && code === 0) throw new Error('An unsafe operation was unexpectedly accepted')
  return text
}
const health = async () => {
  try { const response = await fetch(origin + '/api/hulala/health', { signal: AbortSignal.timeout(500) }); return await response.json() as any } catch { return undefined }
}
let pid: number | undefined
try {
  await mkdir(join(state, 'config'), { recursive: true }); await writeFile(join(state, 'config/preserve-user.txt'), 'keep user data')
  if (process.argv.includes('--archive')) {
    const bootstrap = join(temporary, process.platform === 'win32' ? 'installer.exe' : 'installer')
    await cp(executable, bootstrap)
    await run(bootstrap, ['install', '--from', source + '.tar.gz', '--sha256', await fileSha256(source + '.tar.gz'), '--root', root, '--bin', bin])
  } else await run(executable, ['install', '--root', root, '--bin', bin])
  if (await health()) throw new Error('Installation unexpectedly started the user service')
  if ((await run(installed, ['--version'])).trim() !== manifest.version) throw new Error('Stable launcher returned the wrong version')
  await run(executable, ['install', '--root', root, '--bin', bin])
  await run(installed, ['--no-open'])
  const first = await health(); pid = first?.pid
  if (first?.version !== manifest.version || first.workbench?.state !== 'running') throw new Error('Installed stable launcher did not start the service')
  const entry = await fetch(origin, { redirect: 'manual' }), cookie = entry.headers.get('set-cookie')!.split(';')[0]!
  const prefix = '/api/browser/workspaces/' + entry.headers.get('location')!.split('/')[2]
  const bootstrap = await (await fetch(origin + prefix + '/bootstrap', { headers: { cookie } })).json() as any
  const active = await Bun.file(join(root, 'active.json')).json()
  const bundledBun = join(root, 'versions', active.current.id, 'runtime/bin', process.platform === 'win32' ? 'bun.exe' : 'bun')
  const started = await fetch(origin + prefix + '/api/commands', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: bootstrap.nativeWorkspace.id, command: [bundledBun, '-e', 'setTimeout(()=>{},30000)'] }) })
  if (!started.ok) throw new Error('Could not start a packaged command')
  const command = await started.json() as { id: string }
  const refusal = await run(installed, ['service', 'restart'], false)
  if (!refusal.includes('--force') || (await health())?.workbench.pid !== first.workbench.pid) throw new Error('Busy restart was not safely refused')
  await run(installed, ['service', 'restart', '--force'])
  const second = await health()
  if (second?.pid !== first.pid || second.workbench?.pid === first.workbench.pid) throw new Error('Explicit restart did not replace only the Workspace service')
  const renewed = await fetch(origin, { redirect: 'manual' }), newCookie = renewed.headers.get('set-cookie')!.split(';')[0]!
  const previous = await fetch(origin + prefix + '/api/commands/' + command.id, { headers: { cookie: newCookie } })
  if (!previous.ok || ['running', 'stopping'].includes((await previous.json() as any).state)) throw new Error('Stopped command did not retain a terminal state')
  const removal = await run(installed, ['uninstall'])
  if (process.platform === 'win32') {
    const result = removal.match(/Completion result: ([^\r\n]+)/)?.[1]
    if (!result) throw new Error('Deferred Windows removal did not return a completion location')
    const deadline = Date.now() + 30000
    while (!await Bun.file(result).exists() && Date.now() < deadline) await Bun.sleep(100)
    const completed = await Bun.file(result).json()
    if (!completed.removed || completed.preserved?.length) throw new Error('Deferred Windows removal did not complete: ' + JSON.stringify(completed))
    const helperDeadline = Date.now() + 15000
    while (Date.now() < helperDeadline) {
      try { process.kill(completed.helperPid, 0) } catch { break }
      await Bun.sleep(100)
    }
  }
  if (await Bun.file(installed).exists() || await health()) throw new Error('Uninstall left the command or owned service running')
  pid = undefined
  if (await readFile(join(state, 'config/preserve-user.txt'), 'utf8') !== 'keep user data') throw new Error('Uninstall changed user configuration')
  if (!await Bun.file(join(workspaces, 'workspace/AGENTS.md')).exists()) throw new Error('Uninstall removed the Workspace')
  console.log(JSON.stringify({ installed: true, idempotent: true, noImplicitServiceStartup: true, stableNativeLauncher: true,
    busyRestartRefused: true, explicitRestartPreservesHistory: true, uninstallRemovesOwnedServiceAndCommand: true, userDataPreserved: true, archiveBootstrap: process.argv.includes('--archive') }))
} finally {
  if (pid) { try { process.kill(pid, 'SIGTERM') } catch {}; await Bun.sleep(1000) }
  // The Windows uninstall helper exits just after writing its result. Let its
  // mapped executable and the short-lived cleanup process release the fixture.
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
