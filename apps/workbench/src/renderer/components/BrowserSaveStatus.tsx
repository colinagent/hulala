import { useSyncExternalStore } from 'react'
import type { EditorTab } from '../store/appStore'
import { getDraftStatus, subscribeDraftStatus } from '../../platform/draftStatus'

export function BrowserSaveStatus({ document, compare }: { document?: EditorTab | null; compare: (path: string) => void }) {
  const status = useSyncExternalStore(subscribeDraftStatus, () => getDraftStatus(document?.id || ''))
  if (!document || !['markdown', 'text', 'excalidraw'].includes(document.editorId)) return null
  const label = document.saveFailed ? 'Save failed — draft retained' : document.recoveredFromBackup ? 'Recovered draft'
    : !document.isDirty ? 'Saved to file' : status === 'persisted' ? 'Draft backed up' : status === 'failed' ? 'Backup failed' : 'Backing up…'
  return <span className="shrink-0" role="status">{label}
    {(document.recoveredFromBackup || document.saveFailed) && document.filePath ? <button type="button" className="ml-2 text-link-text underline" onClick={() => compare(document.filePath!)}>Compare with file</button> : null}
  </span>
}
