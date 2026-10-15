import { spawn } from 'node:child_process'
import { mkdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { z } from 'zod'
import { connectionDescriptorSchema } from '@hulala/workbench-contracts'
import { resolveHulalaPaths } from '@hulala/workbench-contracts/paths'
import { verifyRemotePackage } from './package'
import { writePrivateJson } from '../config'
import { ensureBrowserDataFormat } from '../browser/data-format'

const inputSchema = z.object({ path: z.string().min(1).max(32768).optional(), root: z.string().max(32768).optional(), force: z.boolean().optional() }).strict()
class RemoteControlError extends Error {
  constructor(readonly code: 'version_conflict' | 'active_work' | 'state_unavailable') { super(code) }
}
const descriptorSchema = connectionDescriptorSchema.extend({ pid: z.number().int().positive(), version: z.string() })
const runtimeRoot = resolve(process.env.HULALA_REMOTE_RUNTIME_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..'))

async function main() {
  const args = process.argv.slice(2)
  const pkg = JSON.parse(await readFile(join(runtimeRoot, 'package.json'), 'utf8')) as { version: string }
  if (args[0] === 'describe') { console.log(JSON.stringify({ platform: process.platform, arch: process.arch, home: homedir(), version: pkg.version })); return }
  if (args[0] === 'verify') {
    if (!/^[a-f0-9]{64}$/.test(args[1] || '')) throw new Error('A pinned remote manifest hash is required')
    const { manifest } = await verifyRemotePackage(runtimeRoot, args[1])
    if (manifest.target !== `${process.platform}-${process.arch}`) throw new Error('Remote package architecture mismatch')
    console.log(JSON.stringify({ valid: true, version: manifest.version })); return
  }
  if (!['start', 'stop'].includes(args[0]!)) throw new Error('Unsupported remote Host operation')
  const raw = await Bun.stdin.text()
  if (Buffer.byteLength(raw) > 65536) throw new Error('Remote startup input is too large')
  const input = inputSchema.parse(JSON.parse(raw))
  const paths = resolveHulalaPaths(input.root)
  await ensureBrowserDataFormat(paths.root)
  const selected = input.path || paths.workspace
  if (!input.path) await mkdir(selected, { recursive: true, mode: 0o700 })
  const path = await realpath(selected)
  if (!(await stat(path)).isDirectory()) throw new Error('Remote Workspace is not a directory')
  const hash = createHash('sha256').update(path).digest('hex')
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
  const directory = join(paths.server, 'remote-hosts', id)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const descriptorFile = join(directory, 'connection.json'), lock = join(directory, 'start.lock'), desiredFile = join(directory, 'desired-version.json')
  const checkDesired = async () => {
    const desired = await readFile(desiredFile, 'utf8').then(text => JSON.parse(text) as { version?: string }, error => { if (error.code === 'ENOENT') return {} as { version?: string }; throw error })
    if (desired.version && desired.version !== pkg.version) throw new RemoteControlError('version_conflict')
  }
  if (args[0] === 'start') await checkDesired()
  const live = async () => {
    let existing: z.infer<typeof descriptorSchema> | undefined
    try {
      const descriptor = descriptorSchema.parse(JSON.parse(await readFile(descriptorFile, 'utf8')))
      existing = descriptor
      const url = new URL(descriptor.httpUrl)
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return null
      const response = await fetch(new URL('/api/desktop/v1/health', url), { headers: { 'x-hulala-token': descriptor.token }, signal: AbortSignal.timeout(1000), proxy: false } as RequestInit)
      const health = await response.json() as { instanceId: string; pid: number; paths: { workspace: string }; version: string; runtime?: { state?: string } }
      if (!response.ok || health.instanceId !== descriptor.instanceId || health.pid !== descriptor.pid || health.paths.workspace !== path) return null
      if (health.runtime && health.runtime.state !== 'running') throw new RemoteControlError('state_unavailable')
      if (args[0] === 'start' && health.version !== pkg.version) throw new RemoteControlError('version_conflict')
      return descriptor
    } catch (error) {
      if (error instanceof RemoteControlError) throw error
      if (existing) {
        try { process.kill(existing.pid, 0); throw new RemoteControlError('state_unavailable') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      }
      return null
    }
  }
  let descriptor = await live()
  if (args[0] === 'stop') {
    const lockDeadline = Date.now() + 30000
    for (;;) {
      try { await mkdir(lock); break }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const info = await stat(lock).catch(() => null)
        if (!info) continue
        if (Date.now() - info.mtimeMs > 60000) { await rm(lock, { recursive: true, force: true }); continue }
        if (Date.now() > lockDeadline) throw new RemoteControlError('state_unavailable')
        await Bun.sleep(100)
      }
    }
    try {
    descriptor = await live()
    if (descriptor) {
      const request = (quiesce: boolean) => fetch(new URL('/api/desktop/v1/lifecycle', descriptor!.httpUrl), {
        method: 'POST', headers: { 'x-hulala-token': descriptor!.token, 'content-type': 'application/json' }, body: JSON.stringify({ quiesce }), signal: AbortSignal.timeout(25000), proxy: false,
      } as RequestInit)
      try {
        const response = await request(true)
        const state = await response.json() as Record<string, unknown>
        if (!response.ok) throw new RemoteControlError('state_unavailable')
        if (!input.force && ['commands', 'conversations', 'cron', 'plugins'].some(key => typeof state[key] !== 'number' || Number(state[key]) > 0)) throw new RemoteControlError('active_work')
      } catch (error) {
        await request(false).catch(() => undefined)
        if (error instanceof RemoteControlError) throw error
        throw new RemoteControlError('state_unavailable')
      }
      try {
        await writePrivateJson(desiredFile, { version: pkg.version })
        process.kill(descriptor.pid, 'SIGTERM')
        const deadline = Date.now() + 15000
        let exited = false
        while (Date.now() < deadline) {
          try { process.kill(descriptor.pid, 0) }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') { exited = true; break }; throw error }
          await Bun.sleep(100)
        }
        if (!exited) throw new RemoteControlError('state_unavailable')
      } catch (error) { await request(false).catch(() => undefined); throw error }
    } else await writePrivateJson(desiredFile, { version: pkg.version })
    console.log(JSON.stringify({ stopped: true, path })); return
    } finally { await rm(lock, { recursive: true, force: true }) }
  }
  if (!descriptor) {
    let claimed = false
    const deadline = Date.now() + 30000
    while (!claimed) {
      try { await mkdir(lock); claimed = true }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (Date.now() - (await stat(lock)).mtimeMs > 60000) { await rm(lock, { recursive: true, force: true }); continue }
        descriptor = await live(); if (descriptor) break
        if (Date.now() > deadline) throw new Error('Another remote startup is still in progress')
        await Bun.sleep(100)
      }
    }
    if (claimed) try {
      await checkDesired()
      descriptor = await live()
      if (!descriptor) {
        const child = spawn(process.execPath, [join(runtimeRoot, 'host/worker.js'), '--port', '0', '--hulala-home', paths.root,
          '--workspace-root', paths.workspaceRoot, '--runtime-host-module', join(runtimeRoot, 'runtime/host.js'),
          '--runtime-repository-root', runtimeRoot, '--descriptor-file', descriptorFile], {
          detached: true, stdio: 'ignore', env: { ...process.env, HULALA_VERSION: pkg.version, HULALA_BROWSER_WORKSPACE_ID: id, HULALA_BROWSER_WORKSPACE_PATH: path, DSH_TELEMETRY_DISABLED: '1' },
        })
        child.unref()
        while (!(descriptor = await live())) {
          if (Date.now() > deadline) { child.kill(); throw new Error('Remote Host did not become ready') }
          await Bun.sleep(100)
        }
      }
    } finally { await rm(lock, { recursive: true, force: true }) }
  }
  console.log(JSON.stringify({ descriptor, path, home: homedir(), platform: process.platform, arch: process.arch, version: pkg.version }))
}

void main().catch(error => {
  if (error instanceof RemoteControlError) { console.log(JSON.stringify({ error: { code: error.code } })); return }
  console.error('Remote Host operation failed. Check remote permissions, package integrity and data-format compatibility.'); process.exitCode = 1
})
