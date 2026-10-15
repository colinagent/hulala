import { sessionStore } from "../../../platform/storage";
import { useEffect, useMemo, useRef, useState } from 'react'
import { createCronService, type CronTaskRecord, type CronTaskHistoryEntry } from '../../services/cronService'
import { useAppStore, useWorkspaceViewId } from '../../store/appStore'
import { useModelsStore } from '../../store/modelsStore'
import { useUiStore } from '../../store/uiStore'
import { formatCronTime } from '../../utils/cronDisplay'

type Draft = { name: string; prompt: string; description: string; cwd: string; enabled: boolean; kind: 'every' | 'cron' | 'time'; rule: string; timeZone: string; modelKey: string }
function empty(cwd: string): Draft { return { name: '', prompt: '', description: '', cwd, enabled: false, kind: 'every', rule: '5m', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, modelKey: '' } }
function form(record: CronTaskRecord): Draft {
  const { task } = record, schedule = task.schedule
  return { name: task.name, prompt: task.payload.text || '', description: task.description || '', cwd: task.target.cwd || '', enabled: task.enabled,
    kind: schedule.every ? 'every' : schedule.cron ? 'cron' : 'time', rule: schedule.every || schedule.cron || schedule.time || '',
    timeZone: schedule.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone, modelKey: String(task.payload.data?.modelKey || '') }
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
const field = 'w-full rounded border border-border bg-editor-bg px-3 py-2 text-sm text-prime-text'

export function CronTaskEditor() {
  const viewId = useWorkspaceViewId()
  const document = useAppStore(state => state.documents.find(tab => tab.id === state.activeTabId))
  const cwd = useAppStore(state => state.currentDir) || ''
  const id = document?.editorId.replace(/^cron-task:/, '') || 'new'
  const service = useMemo(() => createCronService(viewId), [viewId])
  const models = useModelsStore(state => state.config.models)
  const [record, setRecord] = useState<CronTaskRecord | null>(null)
  const [draft, setDraft] = useState<Draft>(() => empty(cwd))
  const [baseline, setBaseline] = useState<Draft>(() => empty(cwd))
  const [revision, setRevision] = useState<number>()
  const [loadedKey, setLoadedKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState<CronTaskHistoryEntry[]>([])
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty
  const key = 'hulala.cron-draft.' + viewId + '.' + id
  const loaded = loadedKey === key
  const createId = useRef<string>(crypto.randomUUID())

  useEffect(() => { void useModelsStore.getState().load() }, [])
  useEffect(() => {
    let cancelled = false
    setLoadedKey(''); setError(''); setHistory([])
    void (async () => {
      try {
        const next = id === 'new' ? null : await service.get(id)
        if (id !== 'new' && !next) throw new Error('Scheduled task not found')
        if (cancelled) return
        const saved = sessionStore.getItem(key)
        const restored = saved ? JSON.parse(saved) as { draft: Draft; revision?: number; requestId?: string } : null
        const initial = next ? form(next) : empty(cwd)
        setRecord(next); setBaseline(initial); setDraft(restored?.draft || initial); setRevision(restored?.revision ?? next?.task.revision)
        createId.current = restored?.requestId || crypto.randomUUID()
        if (restored && next && restored.revision !== next.task.revision) setError('The saved task changed in another view. Your draft is preserved; use Reload to review the saved version.')
        setLoadedKey(key)
      } catch (reason) { if (!cancelled) setError(message(reason)) }
    })()
    return () => { cancelled = true }
  }, [id, key, service])
  useEffect(() => {
    if (!loaded) return
    if (dirty) sessionStore.setItem(key, JSON.stringify({ draft, revision, requestId: createId.current }))
    else sessionStore.removeItem(key)
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    if (dirty) window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, draft, key, loaded, revision])
  useEffect(() => {
    if (!loaded || id === 'new') return
    let disposed = false
    const refresh = async () => {
      try {
        const [next, runs] = await Promise.all([service.get(id), service.history(id)])
        if (disposed || !next) return
        setRecord(next); setHistory(runs)
        if (!dirtyRef.current) { const value = form(next); setDraft(value); setBaseline(value); setRevision(next.task.revision) }
      } catch (reason) { if (!disposed) setError(message(reason)) }
    }
    void refresh()
    const off = window.hulala!.desktop.onEvent(event => { if (event.tabId === viewId && (event.event as { type?: string }).type === 'cron.changed') void refresh() })
    return () => { disposed = true; off() }
  }, [id, service, viewId, loaded])

  const change = (patch: Partial<Draft>) => { setDraft(value => ({ ...value, ...patch })); setNotice('') }
  const save = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const saved = await service.update({ id: id === 'new' ? '' : id, revision, requestId: createId.current,
        name: draft.name, description: draft.description, enabled: draft.enabled,
        schedule: { [draft.kind]: draft.rule, timeZone: draft.timeZone }, target: { kind: 'workspace', cwd: draft.cwd },
        payload: { kind: 'prompt', text: draft.prompt, data: { modelKey: draft.modelKey } } })
      if (!saved) throw new Error('Task could not be saved')
      sessionStore.removeItem(key)
      const next = form(saved); setRecord(saved); setDraft(next); setBaseline(next); setRevision(saved.task.revision); setNotice('Saved')
      const store = useAppStore.getState()
      store.openCronTaskTab(saved.task.id, saved.task.name)
      if (id === 'new' && document) store.closeTab(document.id)
    } catch (reason) { setError(message(reason)) } finally { setBusy(false) }
  }
  const run = async () => { setBusy(true); setError(''); try { await service.run(id); setNotice('Run accepted') } catch (reason) { setError(message(reason)) } finally { setBusy(false) } }
  const remove = async () => {
    if (!window.confirm('Delete this scheduled task and its run history?')) return
    try { await service.remove(id); sessionStore.removeItem(key); if (document) useAppStore.getState().closeTab(document.id) } catch (reason) { setError(message(reason)) }
  }
  const reload = async () => {
    if (dirty && !window.confirm('Replace your unsaved draft with the saved task?')) return
    try { const next = await service.get(id); if (next) { const value = form(next); setRecord(next); setDraft(value); setBaseline(value); setRevision(next.task.revision); setError('') } } catch (reason) { setError(message(reason)) }
  }
  return <section className="h-full overflow-auto bg-editor-bg p-4 text-prime-text" aria-label="Scheduled task">
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center gap-3"><h2 className="flex-1 text-sm font-semibold">{id === 'new' ? 'New scheduled task' : record?.task.name || 'Scheduled task'}</h2>{id !== 'new' ? <><button onClick={() => void reload()} className="text-xs">Reload</button><button disabled={busy || !!record?.state?.runningAtMs} onClick={() => void run()} className="text-xs">Run now</button><button onClick={() => void remove()} className="text-xs text-accent">Delete</button></> : null}</header>
      {error ? <div role="alert" className="text-sm text-accent">{error}</div> : null}
      {notice ? <div role="status" className="text-xs text-health-text">{notice}</div> : null}
      <fieldset disabled={busy || !loaded} className="space-y-4 border-0 p-0">
      <label className="block text-xs">Task name<input className={field} value={draft.name} onChange={event => change({ name: event.target.value })} /></label>
      <label className="block text-xs">Prompt<textarea className={field + ' min-h-28'} value={draft.prompt} onChange={event => change({ prompt: event.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs">Schedule<select className={field} value={draft.kind} onChange={event => change({ kind: event.target.value as Draft['kind'], rule: event.target.value === 'every' ? '5m' : event.target.value === 'cron' ? '0 9 * * 1-5' : new Date(Date.now() + 3600000).toISOString() })}><option value="every">Fixed interval</option><option value="cron">Cron expression</option><option value="time">One-time date</option></select></label><label className="block text-xs">{draft.kind === 'every' ? 'Interval (for example 5m, 1h)' : draft.kind === 'cron' ? 'Cron expression' : 'ISO date with UTC offset'}<input className={field} value={draft.rule} onChange={event => change({ rule: event.target.value })} /></label></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs">Time zone<input className={field} value={draft.timeZone} onChange={event => change({ timeZone: event.target.value })} /></label><label className="block text-xs">Model<select className={field} value={draft.modelKey} onChange={event => change({ modelKey: event.target.value })}><option value="">Workspace default</option>{draft.modelKey && !models.some(model => model.key === draft.modelKey) ? <option value={draft.modelKey}>{draft.modelKey}</option> : null}{models.filter(model => model.enabled).map(model => <option key={model.key} value={model.key}>{model.label || model.id}</option>)}</select></label></div>
      <label className="block text-xs">Working directory<input className={field} value={draft.cwd} onChange={event => change({ cwd: event.target.value })} /></label>
      <label className="block text-xs">Description<input className={field} value={draft.description} onChange={event => change({ description: event.target.value })} /></label>
      <div className="flex items-center gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={event => change({ enabled: event.target.checked })} />Enabled</label><button disabled={!loaded || busy || !draft.name.trim() || !draft.prompt.trim()} onClick={() => void save()} className="ui-pill-btn-primary px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Working…' : 'Save'}</button></div>
      </fieldset>
      <p className="text-xs text-secondary-text">The local Host runs this task while browser tabs are closed. After sleep or downtime, missed occurrences are combined into one run. A task already running is not started again.</p>
      {record ? <div className="text-xs text-secondary-text">Next run: {formatCronTime(record.state?.nextRunAtMs)} · Last run: {formatCronTime(record.state?.lastRunAtMs)}{record.state?.lastError ? <p className="text-accent">{record.state.lastError}</p> : null}</div> : null}
      {history.length ? <div className="space-y-2 border-t border-border pt-4"><h3 className="text-sm">Recent runs</h3>{history.map(run => <div key={run.runID} className="flex flex-wrap items-center gap-3 border-b border-border py-2 text-xs"><span>{formatCronTime(run.startedAtMs)}</span><span>{run.trigger}</span><span>{run.status}</span>{run.error ? <span className="text-accent">{run.error}</span> : null}{run.threadID ? <button className="text-brand" onClick={() => useUiStore.getState().openConversation({ kind: 'session', sessionId: run.threadID! })}>Session</button> : null}</div>)}</div> : null}
    </div>
  </section>
}
