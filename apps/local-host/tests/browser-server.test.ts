import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBrowserServer } from '../src/browser/server'
import WebSocket from 'ws'

test('serves the real workbench through authenticated same-origin routes without returning Host tokens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-browser-server-'))
  const previousPi = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = join(root, 'pi')
  const repositoryRoot = join(import.meta.dir, '../../..')
  const handle = await startBrowserServer({ repositoryRoot, hulalaRoot: join(root, 'state'), workspaceRoot: join(root, 'workspaces'), version: 'test', port: 0, publicPort: 0, webDirectory: join(repositoryRoot, 'apps/workbench/dist'), settingsDirectory: join(repositoryRoot, 'apps/workbench/settings') })
  const origin = `http://127.0.0.1:${handle.server.port}`
  let phase = 'bootstrap'
  const stalled = setTimeout(() => console.error('Browser integration is still waiting for: ' + phase), 25000)
  try {
    const entry = await fetch(origin, { redirect: 'manual' })
    expect(entry.status).toBe(302)
    const cookie = entry.headers.get('set-cookie')!.split(';')[0]!
    const page = await fetch(new URL(entry.headers.get('location')!, origin), { headers: { cookie } })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect((await page.text())).toContain('<title>Hulala</title>')
    const id = entry.headers.get('location')!.split('/')[2]
    const path = `/api/browser/workspaces/${id}`
    expect((await fetch(origin + path + '/bootstrap')).status).toBe(401)
    expect((await fetch(origin + path + '/bootstrap', { headers: { cookie, origin: 'https://evil.example' } })).status).toBe(403)
    const bootstrap = await (await fetch(origin + path + '/bootstrap', { headers: { cookie } })).json() as any
    expect(bootstrap.workspace.id).toBe(id)
    expect(JSON.stringify(bootstrap)).not.toContain('token')
    expect(bootstrap.nativeWorkspace.path).toStartWith(await realpath(root))
    phase = 'file and resource HTTP operations'
    await writeFile(join(bootstrap.workspace.path, 'sample.txt'), 'browser fixture')
    const read = await fetch(origin + path + '/api/files/text?workspaceId=' + bootstrap.nativeWorkspace.id + '&path=sample.txt', { headers: { cookie } })
    expect(await read.json()).toMatchObject({ content: 'browser fixture' })
    const uploadUrl = origin + path + '/api/resources/import?workspaceId=' + bootstrap.nativeWorkspace.id + '&path=' + encodeURIComponent('导入 data.bin')
    const binary = new Uint8Array([0, 255, 10, 128, 1])
    const imported = await fetch(uploadUrl, { method: 'PUT', headers: { cookie, 'content-type': 'application/octet-stream' }, body: binary })
    expect(imported.status).toBe(201)
    const importedData = await imported.json() as any
    const streamed = await fetch(origin + path + '/api/resources/' + importedData.resource.id, { headers: { cookie } })
    expect(new Uint8Array(await streamed.arrayBuffer())).toEqual(binary)
    const ranged = await fetch(origin + path + '/api/resources/' + importedData.resource.id, { headers: { cookie, range: 'bytes=1-3' } })
    expect(ranged.status).toBe(206)
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(binary.slice(1, 4))
    expect((await fetch(uploadUrl, { method: 'PUT', headers: { cookie, 'content-type': 'application/octet-stream' }, body: binary })).status).toBe(409)
    const metadata = await (await fetch(origin + path + '/api/files/stat?workspaceId=' + bootstrap.nativeWorkspace.id + '&path=' + encodeURIComponent('导入 data.bin'), { headers: { cookie } })).json() as any
    expect(typeof metadata.version).toBe('string')
    expect((await fetch(uploadUrl + '&expectedVersion=' + encodeURIComponent(metadata.version), { method: 'PUT', headers: { cookie, 'content-type': 'application/octet-stream' }, body: new Uint8Array([9]) })).status).toBe(201)
    expect((await fetch(uploadUrl + '&expectedVersion=' + encodeURIComponent(metadata.version), { method: 'PUT', headers: { cookie, 'content-type': 'application/octet-stream' }, body: binary })).status).toBe(409)
    expect((await fetch(origin + path + '/api/workspaces', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ path: '/' }) })).status).toBe(403)
    phase = 'WebSocket events'
    const stream = new WebSocket(origin.replace('http:', 'ws:') + path + '/events', { headers: { cookie, origin } })
    const ready = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('event timeout')), 5000)
      stream.addEventListener('message', event => { clearTimeout(timer); resolve(JSON.parse(String(event.data))) }, { once: true })
    })
    expect(ready).toEqual({ type: 'browser.connected' })
    const resets: unknown[] = []
    stream.addEventListener('message', event => { const value = JSON.parse(String(event.data)); if (value.type === 'conversation.reset') resets.push(value) })
    // A root-context notification unit test misses Cordis plugin injection errors.
    // Keep a real worker stream open long enough to catch a false reconnect loop.
    await Bun.sleep(1500)
    expect(resets.length).toBeLessThanOrEqual(1)
    stream.close()
    phase = 'safe lifecycle reservation'
    const lifecycle = async (input: unknown) => fetch(origin + '/api/browser/lifecycle', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(input) })
    expect((await fetch(origin + path + '/bootstrap', { headers: { cookie, 'x-hulala-protocol': '2' } })).status).toBe(409)
    const started = await fetch(origin + path + '/api/commands', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: bootstrap.nativeWorkspace.id, command: [process.execPath, '-e', 'setTimeout(()=>{},30000)'] }) })
    expect(started.status).toBe(201)
    const command = await started.json() as { id: string }
    const busy = await lifecycle({ action: 'prepare' })
    expect(busy.status).toBe(409)
    expect(await busy.json()).toMatchObject({ code: 'active_work' })
    const forced = await lifecycle({ action: 'prepare', force: true })
    expect(forced.status).toBe(200)
    const reservation = await forced.json() as { lease: string; summary: { commands: number } }
    expect(reservation.summary.commands).toBe(1)
    const write = () => fetch(origin + '/api/browser/settings', { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ui: { displayLocale: 'en' } }) })
    expect((await write()).status).toBe(409)
    expect((await lifecycle({ action: 'cancel', lease: reservation.lease })).status).toBe(200)
    expect((await write()).status).toBe(200)
    phase = 'command cancellation'
    expect((await fetch(origin + path + '/api/commands/' + command.id, { method: 'DELETE', headers: { cookie } })).status).toBe(200)
  } finally {
    phase = 'Host shutdown'
    try { await handle.stop() } finally { clearTimeout(stalled) }
    if (previousPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousPi
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
