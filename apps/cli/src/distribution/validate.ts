import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localFetch } from '../health.js'

export async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No validation port is available')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}
export async function validateNativeCandidate(directory: string, version: string): Promise<void> {
  const state = await mkdtemp(join(tmpdir(), 'hulala candidate '))
  const port = await availablePort(), backend = await availablePort()
  const child = spawn(join(directory, 'bin', process.platform === 'win32' ? 'hulala.exe' : 'hulala'), ['--foreground', '--no-open'], {
    cwd: state, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, HULALA_HOME: join(state, 'state'), HULALA_WORKSPACE_ROOT: join(state, 'workspaces'), PI_CODING_AGENT_DIR: join(state, 'pi'),
      HULALA_PORT: String(port), HULALA_WORKBENCH_PORT: String(backend), HULALA_NO_OPEN: '1', HULALA_INSTALL_ROOT: undefined, HULALA_REPOSITORY_ROOT: undefined },
  })
  let exited = false, interrupted = false, output = ''
  const interrupt = () => { interrupted = true }
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', chunk => { output = (output + String(chunk)).slice(-4096) })
  const completed = new Promise<void>(resolve => {
    child.once('exit', () => { exited = true; resolve() })
    child.once('error', error => { output = error.message; exited = true; resolve() })
  })
  try {
    const deadline = Date.now() + 45000
    while (!exited && !interrupted && Date.now() < deadline) {
      try {
        const response = await localFetch(`http://127.0.0.1:${port}/api/hulala/health`, { signal: AbortSignal.timeout(700) })
        const value = await response.json() as any
        if (response.ok && value.name === 'hulala' && value.version === version && value.workbench?.state === 'running' && value.pid === child.pid) return
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    if (interrupted) throw new Error('Installation interrupted while validating its candidate')
    throw new Error(`Candidate ${version} (PID ${child.pid}) did not become ready${output ? ': ' + output : ''}`)
  } finally {
    if (!exited) try {
      const endpoint = `http://127.0.0.1:${port}/api/hulala/service`
      const response = await localFetch(endpoint, { signal: AbortSignal.timeout(2000) })
      const service = await response.json() as { launcher?: { pid?: number }; actionToken?: string }
      if (service.launcher?.pid === child.pid && service.actionToken) await localFetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-hulala-token': service.actionToken, origin: `http://127.0.0.1:${port}` },
        body: JSON.stringify({ action: 'shutdown', force: true }), signal: AbortSignal.timeout(5000),
      })
    } catch { /* Terminate only this owned process group if cooperative stop fails. */ }
    if (child.pid && process.platform !== 'win32') try { process.kill(-child.pid, 'SIGTERM') } catch {}
    let timeout: ReturnType<typeof setTimeout> | undefined
    await Promise.race([completed, new Promise(resolve => { timeout = setTimeout(resolve, 8000) })]); clearTimeout(timeout)
    if (!exited && child.pid) {
      if (process.platform !== 'win32') try { process.kill(-child.pid, 'SIGKILL') } catch {}
      else await new Promise<void>(resolve => { const stop = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); stop.once('exit', () => resolve()); stop.once('error', () => resolve()) })
      await completed
    }
    try { await rm(state, { recursive: true, force: true }) }
    finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt) }
  }
}
