import { expect, test } from 'bun:test'
import type { WorkbenchPlatform } from '../renderer/types/platform'
import { installBrowserContext } from './contexts'

test('reference files, events and drafts keep source ownership while the page keeps its primary Workspace', async () => {
  function fixture(name: string) {
    const viewId = crypto.randomUUID()
    const staged: unknown[] = []
    let notify: (value: any) => void = () => {}
    const platform = {
      desktop: {
        connect: async () => ({ instanceId: name }), disconnect: async () => ({}), workspaceContext: async () => ({ instanceId: name }),
        onConnection: (handler: typeof notify) => { notify = handler; return () => {} }, onEvent: () => () => {},
        files: { readText: async () => ({ content: name }), writeText: async (_view: string, path: string, content: string, version: string) => ({ owner: name, path, content, version }) },
        resources: {}, commands: {}, git: {}, cron: {}, messenger: {}, conversation: {},
      },
      backup: { stage: (value: unknown) => staged.push(value), load: async () => [{ workspaceTabId: viewId, content: name }], flush: async () => ({}), delete: async () => ({}) },
    } as unknown as WorkbenchPlatform
    installBrowserContext({ viewId, platform, workspace: { id: crypto.randomUUID(), kind: 'local', name, path: '/' + name, createdAt: new Date().toISOString() } })
    return { viewId, platform, staged, notify: (state: string) => notify({ tabId: viewId, state }) }
  }
  const primary = fixture('primary'), source = fixture('source')
  expect(await primary.platform.desktop.files.readText(primary.viewId, 'same.md')).toEqual({ content: 'primary' })
  expect(await primary.platform.desktop.files.readText(source.viewId, 'same.md')).toEqual({ content: 'source' })
  expect(await primary.platform.desktop.files.writeText(source.viewId, 'same.md', 'reference edit', 'source-version')).toMatchObject({ owner: 'source', version: 'source-version' })
  const seen: unknown[] = []
  const unsubscribe = primary.platform.desktop.onConnection(event => seen.push(event))
  source.notify('connected')
  expect(seen).toEqual([{ tabId: source.viewId, state: 'connected' }])
  unsubscribe()
  const draft = { version: 1 as const, workspaceTabId: source.viewId, id: 'draft', editorId: 'markdown', title: 'Reference', content: 'unsaved', contentVersion: 1 }
  primary.platform.backup.stage(draft)
  expect(source.staged).toEqual([draft])
  expect(primary.staged).toEqual([])
})
