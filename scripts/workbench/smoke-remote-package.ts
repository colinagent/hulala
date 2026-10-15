import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const runtime = resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('Pass a remote Runtime package directory')
const root = await mkdtemp(join(tmpdir(), 'hulala remote package '))
const workspace = join(root, 'Workspace QA')
await mkdir(workspace)
let pid: number | undefined
try {
  const start = async () => {
    const process = Bun.spawn([join(runtime, 'bin', Bun.env.OS === 'Windows_NT' ? 'bun.exe' : 'bun'), join(runtime, 'host/remote-entry.js'), 'start'], {
      cwd: root,
      env: { PATH: '/usr/bin:/bin', HULALA_WORKSPACE_ROOT: join(root, 'workspaces'), PI_CODING_AGENT_DIR: join(root, 'pi'), HULALA_REMOTE_RUNTIME_ROOT: runtime },
      stdin: new Blob([JSON.stringify({ root: join(root, 'state'), path: workspace })]), stdout: 'pipe', stderr: 'pipe',
    })
    const [code, text, error] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()])
    if (code) throw new Error('Installed remote startup failed: ' + error)
    return JSON.parse(text) as { descriptor: { pid: number; token: string; httpUrl: string; instanceId: string }; path: string }
  }
  const [a, b] = await Promise.all([start(), start()])
  pid = a.descriptor.pid
  if (pid !== b.descriptor.pid || a.descriptor.instanceId !== b.descriptor.instanceId) throw new Error('Duplicate remote workers were created')
  const response = await fetch(a.descriptor.httpUrl + '/api/desktop/v1/health', { headers: { 'x-hulala-token': a.descriptor.token } })
  const health = await response.json() as { paths: { workspace: string }; runtime: { connected: boolean } }
  if (!response.ok || !health.paths.workspace.endsWith('/Workspace QA')) throw new Error('Installed remote Host has the wrong Workspace')
  console.log(JSON.stringify({ ready: true, concurrentStartupDeduplicated: true, relocated: true, workspace: true }))
} finally {
  if (pid) { try { process.kill(pid, 'SIGTERM') } catch {}; for (let tries = 0; tries < 100; tries++) { try { process.kill(pid, 0) } catch { break }; await Bun.sleep(50) } }
  await rm(root, { recursive: true, force: true })
}
