import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const entry = join(repository, 'apps/cli/src/main.ts')
const executable = createRequire(import.meta.url).resolve('bun/bin/bun.exe')
async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}
async function waitFor(origin: string): Promise<any> {
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin + '/api/hulala/health', { signal: AbortSignal.timeout(500) })
      const state = await response.json() as any
      if (response.ok && state.workbench?.state === 'running') return state
    } catch { /* Startup is not ready yet. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Browser workbench did not become ready')
}
function finished(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
}

test('reuses and restarts the browser workbench from an arbitrary working directory without crossing state roots', { timeout: 45000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-cli-browser-'))
  const port = await availablePort()
  let backendPort = await availablePort()
  while (backendPort === port) backendPort = await availablePort()
  const origin = `http://127.0.0.1:${port}`
  const env = { ...process.env, HULALA_REPOSITORY_ROOT: repository, HULALA_HOME: join(root, 'state'), HULALA_WORKSPACE_ROOT: join(root, 'workspaces'), PI_CODING_AGENT_DIR: join(root, 'pi'), HULALA_PORT: String(port), HULALA_WORKBENCH_PORT: String(backendPort), HULALA_NO_OPEN: '1' }
  const daemon = spawn(executable, [entry, '__serve'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = finished(daemon)
  let diagnostics = ''
  daemon.stdout?.on('data', () => {})
  daemon.stderr?.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-8192) })
  const run = async (environment = env) => {
    const child = spawn(executable, [entry, '--no-open'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout?.on('data', chunk => { output += String(chunk) })
    child.stderr?.on('data', chunk => { output += String(chunk) })
    return { code: await finished(child), output }
  }
  try {
    const first = await waitFor(origin).catch(error => { throw new Error(`${error.message}: ${diagnostics}`) })
    const reused = await run()
    assert.equal(reused.code, 0, reused.output)
    assert.match(reused.output, new RegExp(`hulala.localhost:${port}`))
    assert.equal((await waitFor(origin)).pid, first.pid)
    const service = await (await fetch(origin + '/api/hulala/service')).json() as { actionToken: string }
    const stopped = await fetch(origin + '/api/hulala/service', {
      method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-hulala-token': service.actionToken }, body: JSON.stringify({ action: 'stop' }),
    })
    assert.equal(stopped.status, 200)
    const restarted = await run()
    assert.equal(restarted.code, 0, restarted.output)
    const second = await waitFor(origin)
    assert.equal(second.pid, first.pid)
    assert.notEqual(second.workbench.pid, first.workbench.pid)
    const wrong = await run({ ...env, HULALA_HOME: join(root, 'different-state') })
    assert.equal(wrong.code, 1)
    assert.match(wrong.output, /different state directory/)
    assert.equal((await waitFor(origin)).pid, first.pid)
  } finally {
    daemon.kill('SIGTERM')
    const timeout = setTimeout(() => daemon.kill('SIGKILL'), 8000)
    await exited
    clearTimeout(timeout)
    await rm(root, { recursive: true, force: true })
  }
})
