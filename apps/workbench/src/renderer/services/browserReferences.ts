import { sessionStore } from "../../platform/storage";
import { attachBrowserWorkspace, browserContext } from '../../platform/contexts'
import { getWorkspaceStore } from '../store/appStore'
import { useRightWorkspaceStore } from '../store/rightWorkspaceStore'

export const BROWSER_REFERENCE_MIME = 'application/x-hulala-workspace-file'
export type BrowserFileReference = { workspaceId: string; path: string }

export function encodeBrowserReference(viewId: string, path: string): string {
  const context = browserContext(viewId)
  return context ? JSON.stringify({ workspaceId: context.workspace.id, path } satisfies BrowserFileReference) : ''
}

export function decodeBrowserReference(value: string): BrowserFileReference | null {
  try {
    const input = JSON.parse(value)
    return /^[a-f0-9-]{36}$/.test(input.workspaceId) && typeof input.path === 'string' && input.path.length < 32768 ? input : null
  } catch { return null }
}

export async function pinBrowserReference(reference: BrowserFileReference): Promise<void> {
  const context = await attachBrowserWorkspace(reference.workspaceId)
  const store = getWorkspaceStore(context.viewId)
  store.getState().setServerUrl('browser:' + context.workspace.id)
  store.getState().setCurrentDir(context.workspace.path)
  if (store.getState().connectionState !== 'connected') {
    store.getState().connect()
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { unsubscribe(); reject(new Error('Source Workspace connection timed out')) }, 15000)
      const unsubscribe = store.subscribe(state => { if (state.connectionState === 'connected') { clearTimeout(timeout); unsubscribe(); resolve() } })
    })
  }
  await store.getState().openFile(reference.path, { pane: 'right' })
  const document = store.getState().documents.find(document => document.filePath === reference.path)
  if (!document) throw new Error('The reference file could not be opened')
  useRightWorkspaceStore.getState().addFile({ workspaceTabId: context.viewId, tabId: document.id, source: { kind: 'local', workspaceId: context.workspace.id, workspacePath: context.workspace.path, label: context.workspace.name } })
}

export function persistBrowserReferences(): void {
  const references = useRightWorkspaceStore.getState().files.flatMap(ref => {
    const context = browserContext(ref.workspaceTabId)
    const document = getWorkspaceStore(ref.workspaceTabId).getState().documents.find(document => document.id === ref.tabId)
    return context && document?.filePath ? [{ workspaceId: context.workspace.id, path: document.filePath }] : []
  })
  sessionStore.setItem('hulala.references.' + location.pathname, JSON.stringify(references))
}

export async function restoreBrowserReferences(): Promise<void> {
  try {
    const raw: unknown = JSON.parse(sessionStore.getItem('hulala.references.' + location.pathname) || '[]')
    if (!Array.isArray(raw)) return
    for (const value of raw.slice(0, 100)) {
      const reference = decodeBrowserReference(JSON.stringify(value))
      if (reference) await pinBrowserReference(reference).catch(error => window.dispatchEvent(new CustomEvent('hulala:notice', { detail: String(error) })))
    }
  } catch { /* Ignore malformed optional pane layout. */ }
}
