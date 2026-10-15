import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'
import { SshHosts } from '../src/ssh/hosts'
import { SshTrust } from '../src/ssh/connection'
import { SshPackages } from '../src/ssh/install'
import { RemoteWorkspaceWorkers } from '../src/ssh/workers'
import { sshFixture, FixtureSecrets } from './fixtures/ssh-server'
import { fileSha256 } from '@hulala/distribution/archive'
import { verifyPackage } from '@hulala/distribution/manifest'

const packages = process.env.HULALA_SSH_TEST_PACKAGES
const nativeRuntime = process.env.HULALA_SSH_TEST_RUNTIME
const releasePackage = process.env.HULALA_SSH_TEST_RELEASE_PACKAGE
test.skipIf((!packages && !nativeRuntime && !releasePackage) || process.platform === 'win32')('installed public Host works over real SSH/SFTP with isolated remote directories and reconnect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala ssh workspaces '))
  const remote = join(root, 'remote'); await mkdir(remote)
  const fixture = await sshFixture(remote)
  const hosts = new SshHosts(join(root, 'local'), new FixtureSecrets(), join(root, 'local'))
  const trust = new SshTrust(join(root, 'local'))
  const oldIndex = process.env.HULALA_RELEASE_INDEX_URL
  let mirror: ReturnType<typeof Bun.serve> | undefined
  if (releasePackage) {
    const manifest = await verifyPackage(releasePackage), archive = releasePackage + '.tar.gz'
    const sha256 = await fileSha256(archive), manifestSha256 = await fileSha256(join(releasePackage, 'manifest.json'))
    mirror = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      if (new URL(request.url).pathname === '/package.tar.gz') return new Response(Bun.file(archive))
      return Response.json({ format: 1, product: 'hulala', channels: { stable: manifest.version }, releases: [{ version: manifest.version, dataFormat: 1, platforms: { [manifest.target]: { url: `http://127.0.0.1:${mirror!.port}/package.tar.gz`, sha256, manifestSha256 } } }] })
    } })
    process.env.HULALA_RELEASE_INDEX_URL = `http://127.0.0.1:${mirror.port}/index`
  }
  const workers = new RemoteWorkspaceWorkers(hosts, trust, new SshPackages(packages || join(root, 'no-extra-platforms'), releasePackage ? undefined : nativeRuntime, releasePackage ? { root: join(root, 'local'), version: '0.1.4' } : undefined), '0.1.4')
  try {
    await hosts.load(); await trust.load()
    const host = await hosts.save({ alias: 'Fixture SSH', hostname: '127.0.0.1', user: 'fixture', port: fixture.port, authMethod: 'password', password: 'fixture-password', rememberSecret: false })
    await expect(workers.open(host.id)).rejects.toMatchObject({ code: 'ssh_host_key_unknown' })
    await trust.accept(host, trust.challenge(host.id)!.fingerprint)
    const a = await workers.open(host.id)
    expect(await workers.open(host.id, a.path)).toBe(a)
    expect(fixture.uploadedBytes()).toBeGreaterThan(1000000)
    const secondPath = join(fixture.home, '项目 B'); await mkdir(secondPath); await writeFile(join(secondPath, 'hello.md'), 'Remote B')
    const b = await workers.open(host.id, secondPath)
    expect(a.descriptor.instanceId).not.toBe(b.descriptor.instanceId)
    const read = await b.request('/files/text?' + new URLSearchParams({ workspaceId: b.workspace.id, path: 'hello.md' }))
    expect(await read.json()).toMatchObject({ content: 'Remote B' })
    const wrong = await a.request('/files/text?' + new URLSearchParams({ workspaceId: a.workspace.id, path: join(secondPath, 'hello.md') }))
    expect(wrong.status).toBe(403)
    const upload = await b.request('/resources/import?' + new URLSearchParams({ workspaceId: b.workspace.id, path: 'binary.bin' }), { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array([0, 255, 127, 1]) })
    expect(upload.status).toBe(201)
    const resource = await upload.json() as { resource: { id: string } }
    const download = await b.request('/resources/' + resource.resource.id)
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array([0, 255, 127, 1]))
    const command = await b.request('/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: b.workspace.id, command: 'printf remote-command-QA', requestId: crypto.randomUUID() }) })
    expect(command.status).toBe(201)
    const commandId = (await command.json() as { id: string }).id
    let output: { state: string; stdout: string } | undefined
    for (let i = 0; i < 100; i++) { output = await (await b.request('/commands/' + commandId)).json() as typeof output; if (output?.state === 'exited') break; await Bun.sleep(25) }
    expect(output).toMatchObject({ state: 'exited', stdout: 'remote-command-QA' })
    const directory = await workers.directory(host.id, secondPath) as { entries: Array<{ name: string }> }
    expect(directory.entries.map(entry => entry.name)).toContain('hello.md')
    const search = await b.request('/files/search?' + new URLSearchParams({ workspaceId: b.workspace.id, path: '.', query: 'Remote B' }))
    expect(search.status).toBe(200)
    expect((await search.json() as { items: Array<{ text: string }> }).items).toMatchObject([{ text: 'Remote B' }])
    const stream = new WebSocket(b.descriptor.eventsUrl, { headers: { 'x-hulala-token': b.descriptor.token } })
    await new Promise<void>((resolve, reject) => { stream.once('open', resolve); stream.once('error', reject) })
    stream.close()
    await a.stop()
    expect((await b.request('/health')).ok).toBeTrue()
    const before = fixture.uploadedBytes()
    fixture.disconnect()
    for (let i = 0; i < 100 && b.alive(); i++) await Bun.sleep(20)
    const [resumed, repeated] = await Promise.all([workers.open(host.id, secondPath), workers.open(host.id, secondPath)])
    expect(repeated).toBe(resumed)
    expect(resumed.descriptor.instanceId).toBe(b.descriptor.instanceId)
    expect(fixture.uploadedBytes()).toBe(before)
    expect((await resumed.request('/health')).ok).toBeTrue()
    const stillA = await workers.open(host.id, a.path)
    const remoteHealth = await (await resumed.request('/health')).json() as { pid: number; instanceId: string }
    expect(remoteHealth.instanceId).toBe(resumed.descriptor.instanceId)
    process.kill(remoteHealth.pid, 'SIGTERM')
    for (let index = 0; index < 100; index++) { try { process.kill(remoteHealth.pid, 0) } catch { break }; await Bun.sleep(50) }
    const afterCrash = await workers.open(host.id, secondPath)
    expect(afterCrash.descriptor.instanceId).not.toBe(resumed.descriptor.instanceId)
    const running = await afterCrash.request('/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: afterCrash.workspace.id, command: 'sleep 30', requestId: crypto.randomUUID() }) })
    expect(running.status).toBe(201)
    await expect(workers.restart(host.id, secondPath)).rejects.toMatchObject({ code: 'ssh_active_work' })
    const restarted = await workers.restart(host.id, secondPath, true)
    expect(restarted.descriptor.instanceId).not.toBe(afterCrash.descriptor.instanceId)
    expect((await stillA.request('/health')).ok).toBeTrue()
    expect(stillA.descriptor.instanceId).toBe(a.descriptor.instanceId)
  } catch (error) { console.error({ uploadedBytes: fixture.uploadedBytes(), commands: fixture.failures }); throw error }
  finally {
    await workers.stop(); await fixture.stop(); mirror?.stop(true)
    if (oldIndex === undefined) delete process.env.HULALA_RELEASE_INDEX_URL; else process.env.HULALA_RELEASE_INDEX_URL = oldIndex
    await rm(root, { recursive: true, force: true })
  }
}, 300000)
