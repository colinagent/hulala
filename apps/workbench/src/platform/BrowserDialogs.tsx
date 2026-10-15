import { useEffect, useMemo, useRef, useState } from 'react'
import { DirectoryPickerDialog } from '../renderer/components/FileDialog/DirectoryPickerDialog'
import { createLocalDirectoryPickerProvider } from '../renderer/components/FileDialog/directoryPickerProviders'
import { DIRECTORY_REQUEST_EVENT, SECRET_REQUEST_EVENT, type BrowserDirectoryRequest, type BrowserSecretRequest } from './dialogs'
import { browserJson } from './browser'
import { useTranslation } from 'react-i18next'
import { useBlockingModal } from '../renderer/utils/useBlockingModal'
import { onStorageIssue, storageIssues } from './storage'

export function BrowserDialogs() {
  const { t } = useTranslation('settings')
  const [request, setRequest] = useState<BrowserDirectoryRequest | null>(null)
  const [blocked, setBlocked] = useState<{ url: string; name: string } | null>(null)
  const [notice, setNotice] = useState<{ message: string; actionLabel?: string; action?: () => Promise<void> } | null>(null)
  const [secret, setSecret] = useState<BrowserSecretRequest | null>(null)
  const [secretValue, setSecretValue] = useState('')
  const [secretError, setSecretError] = useState('')
  const [savingSecret, setSavingSecret] = useState(false)
  const savingSecretRef = useRef(false)
  const [storageProblem, setStorageProblem] = useState(() => storageIssues())
  useEffect(() => onStorageIssue(() => setStorageProblem(storageIssues())), [])
  useBlockingModal(Boolean(secret))
  const closeSecret = () => { secret?.resolve(false); setSecret(null); setSecretValue(''); setSecretError('') }
  const provider = useMemo(() => createLocalDirectoryPickerProvider(), [])
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      try {
        const status = await browserJson<{ starting: boolean; failed: Array<{ id: string; name: string }> }>('/api/browser/background')
        if (disposed) return
        if (status.starting) { timer = setTimeout(() => { void check() }, 1000); return }
        if (status.failed.length) setNotice({ message: 'Scheduled work could not start in: ' + status.failed.map(item => item.name).join(', ') + '. Open the Workspace to check its directory and runtime.', actionLabel: 'Open Workspace', action: async () => { window.open('/w/' + status.failed[0]!.id, '_blank', 'noopener') } })
      } catch { if (!disposed) timer = setTimeout(() => { void check() }, 3000) }
    }
    void check()
    return () => { disposed = true; clearTimeout(timer) }
  }, [])
  useEffect(() => {
    const select = (event: Event) => setRequest(previous => { previous?.resolve(null); return (event as CustomEvent<BrowserDirectoryRequest>).detail })
    const opened = (event: Event) => setBlocked((event as CustomEvent).detail)
    const notified = (event: Event) => { const detail = (event as CustomEvent).detail; setNotice(typeof detail === 'string' ? { message: detail } : detail) }
    const configure = (event: Event) => {
      const next = (event as CustomEvent<BrowserSecretRequest>).detail
      if (savingSecretRef.current) { next.resolve(false); return }
      setSecret(previous => { previous?.resolve(false); return next }); setSecretValue(''); setSecretError('')
    }
    window.addEventListener(DIRECTORY_REQUEST_EVENT, select)
    window.addEventListener('hulala:open-blocked', opened)
    window.addEventListener('hulala:notice', notified)
    window.addEventListener(SECRET_REQUEST_EVENT, configure)
    return () => { window.removeEventListener(DIRECTORY_REQUEST_EVENT, select); window.removeEventListener('hulala:open-blocked', opened); window.removeEventListener('hulala:notice', notified); window.removeEventListener(SECRET_REQUEST_EVENT, configure) }
  }, [])
  return <>
    {storageProblem.length ? <div role="status" className="fixed bottom-8 left-1/2 z-[12000] max-w-lg -translate-x-1/2 rounded border border-border bg-editor-bg p-3 text-sm text-prime-text">
      {t(storageProblem.includes('drafts') ? 'browser.hostDraftFallback' : 'browser.temporaryPreferences')}
      <button type="button" className="ml-3" aria-label={t('browser.dismiss')} onClick={() => setStorageProblem([])}>×</button>
    </div> : null}
    {secret ? <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/40 p-4" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!savingSecretRef.current) closeSecret() } }}>
      <form role="dialog" aria-modal="true" aria-label={t('localPlugins.credentialTitle')} className="w-full max-w-md space-y-4 rounded border border-border bg-editor-bg p-5 text-prime-text" onKeyDown={event => {
        if (event.key !== 'Tab') return
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')]
        const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1) : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : undefined
        if (target) { event.preventDefault(); target.focus() }
      }} onSubmit={event => {
        event.preventDefault(); if (!secretValue || savingSecretRef.current) return
        savingSecretRef.current = true; setSavingSecret(true); setSecretError('')
        void secret.save(secretValue).then(() => { secret.resolve(true); setSecret(null); setSecretValue('') }, error => setSecretError(error instanceof Error ? error.message : String(error))).finally(() => { savingSecretRef.current = false; setSavingSecret(false) })
      }}>
        <h2 className="text-base font-semibold">{t('localPlugins.credentialTitle')}</h2>
        <p className="text-sm">{secret.plugin} · {secret.name}</p>
        <label className="block space-y-2 text-sm">{t('localPlugins.credentialValue')}<input autoFocus type="password" autoComplete="new-password" spellCheck={false} maxLength={8192} value={secretValue} disabled={savingSecret} onChange={event => setSecretValue(event.target.value)} className="w-full rounded border border-border bg-editor-bg px-3 py-2" /></label>
        <p className="text-xs text-secondary-text">{t('localPlugins.credentialHint')}</p>
        {secretError ? <p role="alert" className="text-sm text-accent">{secretError}</p> : null}
        <div className="flex justify-end gap-4"><button type="button" disabled={savingSecret} onClick={closeSecret}>{t('localPlugins.cancel')}</button><button type="submit" disabled={!secretValue || savingSecret} className="text-highlight disabled:opacity-50">{t('localPlugins.save')}</button></div>
      </form>
    </div> : null}
    {notice ? <div role="alert" className="fixed top-8 left-1/2 -translate-x-1/2 z-[12000] max-w-xl border border-border bg-editor-bg p-3 rounded shadow-lg">{notice.message}
      {notice.action ? <button className="ml-3 text-link-text underline" type="button" onClick={() => { const action = notice.action; setNotice(null); void action?.() }}>{notice.actionLabel}</button> : null}
      <button className="ml-3" type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></div> : null}
    <DirectoryPickerDialog open={Boolean(request)} title={request?.title || 'Select directory'} mode={request?.mode} defaultPath={request?.defaultPath} provider={request?.provider || provider} allowCreate={!request?.mode && !request?.provider}
      onClose={() => { request?.resolve(null); setRequest(null) }}
      onSelect={async path => { request?.resolve(path); setRequest(null) }} />
    {blocked ? <div role="alert" className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[12000] border border-border bg-editor-bg p-3 rounded shadow-lg">
      <span>Browser blocked the new tab. </span><a href={blocked.url} target="_blank" rel="noopener noreferrer" className="text-link-text underline" onClick={() => setBlocked(null)}>Open {blocked.name}</a>
      <button type="button" className="ml-3" onClick={() => setBlocked(null)} aria-label="Dismiss">×</button>
    </div> : null}
  </>
}
