import { useEffect, useState } from 'react'
import type { BrowserWorkspace } from '@hulala/workbench-contracts/browser'
import { browserJson } from './browser'
import { attachBrowserWorkspace, type BrowserWorkspaceContext } from './contexts'
import { DirectoryPickerDialog } from '../renderer/components/FileDialog/DirectoryPickerDialog'
import { pinBrowserReference } from '../renderer/services/browserReferences'
import { useBlockingModal } from '../renderer/utils/useBlockingModal'

export function BrowserReferenceDialog({ open, close }: { open: boolean; close: () => void }) {
  const [workspaces, setWorkspaces] = useState<BrowserWorkspace[]>([])
  const [selected, setSelected] = useState('')
  const [context, setContext] = useState<BrowserWorkspaceContext | null>(null)
  const [error, setError] = useState('')
  useBlockingModal(open && !context)
  useEffect(() => {
    if (!open) { setContext(null); return }
    void browserJson<{ items: BrowserWorkspace[] }>('/api/browser/workspaces').then(result => { setWorkspaces(result.items); setSelected(result.items[0]?.id || '') }).catch(error => setError(String(error)))
  }, [open])
  if (!open) return null
  if (context) return <DirectoryPickerDialog open mode="openFile" title={'Reference from ' + context.workspace.name} defaultPath={context.workspace.path} submitLabel="Pin reference" allowCreate={false}
    provider={{ kind: 'remote', listDirectory: path => context.platform.desktop.files.readdir(context.viewId, path), statPath: path => context.platform.desktop.files.stat(context.viewId, path), getQuickAccess: async () => [{ key: 'source', label: context.workspace.name, path: context.workspace.path }] }}
    onSelect={path => pinBrowserReference({ workspaceId: context.workspace.id, path })} onClose={close} />
  return <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50"><div role="dialog" aria-modal="true" aria-label="Reference file" className="w-96 rounded border border-border bg-editor-bg p-4">
    <h2>Reference file</h2><p className="my-3 text-sm text-secondary-text">Choose the file’s Workspace. Edits are saved there.</p>
    <select aria-label="Source Workspace" className="w-full border border-border bg-editor-bg p-2" value={selected} onChange={event => setSelected(event.target.value)}>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name} — {workspace.path}</option>)}</select>
    {error ? <p role="alert">{error}</p> : null}<div className="mt-4 flex justify-end gap-3"><button type="button" onClick={close}>Cancel</button><button type="button" disabled={!selected} onClick={() => { void attachBrowserWorkspace(selected).then(setContext).catch(error => setError(String(error))) }}>Choose file…</button></div>
  </div></div>
}
