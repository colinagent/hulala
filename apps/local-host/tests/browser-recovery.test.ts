import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserRecovery } from '../src/browser/recovery'

test('recovers durable drafts after restart while preserving active views and conflicting buffers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-drafts-'))
  try {
    const workspace = crypto.randomUUID(), otherWorkspace = crypto.randomUUID()
    const a = crypto.randomUUID(), b = crypto.randomUUID(), c = crypto.randomUUID()
    let service = new BrowserRecovery(root)
    const request = (workspaceId: string, action: string, value: unknown, method = 'POST') => service.request(workspaceId, action, new Request('http://localhost' + action, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }))
    const draft = (viewId: string, content: string) => ({ version: 1, workspaceTabId: viewId, id: 'document', title: 'Draft', content, contentVersion: 1, editorId: 'markdown', filePath: 'shared.md', fileVersion: 'read-version' })
    await request(workspace, '/drafts', draft(a, 'first buffer'), 'PUT')
    await request(workspace, '/drafts', draft(b, 'second buffer'), 'PUT')
    service = new BrowserRecovery(root)
    const disconnectB = service.connectView(workspace, b)
    expect(await (await request(otherWorkspace, '/drafts/restore', { viewId: c, activeViews: [] })).json()).toEqual([])
    // Another browser profile cannot enumerate B's Web Locks, so the Host lease
    // must protect the active view independently of the supplied browser list.
    const recovered = await (await request(workspace, '/drafts/restore', { viewId: c, activeViews: [] })).json() as any[]
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({ workspaceTabId: c, content: 'first buffer', fileVersion: 'read-version' })
    disconnectB()
    const both = await (await request(workspace, '/drafts/restore', { viewId: c, activeViews: [] })).json() as any[]
    expect(both.map(record => record.content).sort()).toEqual(['first buffer', 'second buffer'])
    expect(new Set(both.map(record => record.id)).size).toBe(2)
    await request(workspace, '/drafts', both[0], 'DELETE')
    service = new BrowserRecovery(root)
    expect(await (await request(workspace, '/drafts/restore', { viewId: c, activeViews: [] })).json()).toHaveLength(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Host restart protects open-view drafts until reconnect or a bounded grace period', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala recovery reconnect '))
  let now = 100000
  const workspace = crypto.randomUUID(), owner = crypto.randomUUID(), stranger = crypto.randomUUID()
  const request = (service: BrowserRecovery, action: string, value: unknown, method = 'POST') => service.request(workspace, action, new Request('http://localhost' + action, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }))
  try {
    const original = new BrowserRecovery(root, () => now), disconnect = original.connectView(workspace, owner)
    await request(original, '/drafts', { version: 1, workspaceTabId: owner, id: 'draft', title: 'Draft', editorId: 'markdown', contentVersion: 1, content: 'still editing' }, 'PUT')
    await original.sealViews(); disconnect(); await original.flush()
    const restarted = new BrowserRecovery(root, () => now)
    const views = await (await restarted.request(workspace, '/views', new Request('http://localhost/views?viewId=' + stranger))).json() as any
    expect(views.recoveryWaitMs).toBe(30000)
    expect(await (await request(restarted, '/drafts/restore', { viewId: stranger, activeViews: [] })).json()).toEqual([])
    const release = restarted.connectView(workspace, owner)
    expect(await (await request(restarted, '/drafts/restore', { viewId: owner, activeViews: [] })).json()).toHaveLength(1)
    expect(await (await request(restarted, '/drafts/restore', { viewId: stranger, activeViews: [] })).json()).toEqual([])
    await restarted.sealViews(); release(); await restarted.flush()
    now += 31000
    const abandoned = new BrowserRecovery(root, () => now)
    expect(await (await request(abandoned, '/drafts/restore', { viewId: stranger, activeViews: [] })).json()).toHaveLength(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
