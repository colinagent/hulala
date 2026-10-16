import { sessionStore } from "../../../platform/storage";
import { useEffect, useRef, useState } from 'react'
import type { CommandSnapshot, CommandSummary } from '@hulala/workbench-contracts'
import { useAppStore, useWorkspaceViewId } from '../../store/appStore'

function displayCommand(command: string[]): string { return command[1] === '-lc' || command[1] === '/d' ? command.at(-1)! : command.join(' ') }
function pendingDelivery(key: string): { command: string; id: string } | undefined {
  try { const value = JSON.parse(sessionStore.getItem(key) || 'null'); return value && typeof value.command === 'string' && typeof value.id === 'string' ? value : undefined } catch { return undefined }
}

export function CommandsEditor() {
  const viewId = useWorkspaceViewId()
  const cwd = useAppStore(state => state.currentDir)
  const [command, setCommand] = useState(() => sessionStore.getItem('hulala.command.' + viewId) || '')
  const [input, setInput] = useState('')
  const [records, setRecords] = useState<CommandSummary[]>([])
  const [selected, setSelected] = useState('')
  const [snapshot, setSnapshot] = useState<CommandSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pendingKey = 'hulala.command.pending.' + viewId
  const pending = useRef(pendingDelivery(pendingKey))
  const commandRef = useRef(command); commandRef.current = command
  const api = window.hulala!.desktop.commands
  useEffect(() => { sessionStore.setItem('hulala.command.' + viewId, command) }, [command, viewId])
  useEffect(() => {
    let disposed = false, loading = false
    const refresh = async () => {
      if (loading) return
      loading = true
      try {
        const result = await api.list(viewId)
        if (disposed) return
        setRecords(result.items)
        const id = result.items.some(item => item.id === selected) ? selected : result.items.at(-1)?.id || ''
        if (id !== selected) { setSelected(id); setSnapshot(null); return }
        if (id) { const next = await api.get(viewId, id); if (!disposed) setSnapshot(next) }
      } catch (reason) { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) }
      finally { loading = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 1000)
    const off = window.hulala!.desktop.onEvent(event => { if (event.tabId === viewId && (event.event as { type?: string }).type === 'command.changed') void refresh() })
    return () => { disposed = true; clearInterval(timer); off() }
  }, [api, selected, viewId])
  const run = async () => {
    if (busy || !command.trim()) return
    setBusy(true); setError('')
    if (pending.current?.command !== command) pending.current = { command, id: crypto.randomUUID() }
    try {
      sessionStore.setItem(pendingKey, JSON.stringify(pending.current))
      const result = await api.start(viewId, { command, cwd: cwd || '.', requestId: pending.current.id })
      setSelected(result.id)
      const remaining = commandRef.current === command ? '' : commandRef.current
      sessionStore.setItem('hulala.command.' + viewId, remaining)
      sessionStore.removeItem(pendingKey)
      setCommand(remaining)
      pending.current = undefined
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const send = async () => {
    try { await api.write(viewId, selected, input + '\n'); setInput('') } catch (reason) { setError(String(reason)) }
  }
  return <section className="flex h-full min-h-0 flex-col gap-3 p-4" aria-label="Workspace commands">
    <div className="text-sm font-medium">Commands</div>
    <div className="truncate text-xs text-secondary-text" title={cwd || ''}>{cwd}</div>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void run() }}>
      <input aria-label="Command" className="min-w-0 flex-1 border border-border bg-editor-bg px-2 py-1 text-sm" value={command} onChange={event => setCommand(event.target.value)} placeholder="Enter a shell command" autoComplete="off" spellCheck={false} />
      <button type="submit" disabled={busy || !command.trim()} className="px-3 text-sm disabled:opacity-50">Run</button>
    </form>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <select aria-label="Command history" className="min-w-0 max-w-full flex-1 border border-border bg-editor-bg p-1" value={selected} onChange={event => { setSelected(event.target.value); setSnapshot(null) }}><option value="" disabled>Recent commands</option>{records.map(record => <option key={record.id} value={record.id}>{displayCommand(record.command)} · {record.state}</option>)}</select>
      {snapshot ? <span>{snapshot.state}{snapshot.exitCode !== undefined && snapshot.exitCode !== null ? ` · exit ${snapshot.exitCode}` : ''}</span> : null}
      {snapshot?.state === 'running' ? <button type="button" onClick={() => { void api.stop(viewId, selected).catch(reason => setError(String(reason))) }}>Stop</button> : null}
    </div>
    {error || snapshot?.error ? <div role="alert" className="text-xs text-accent">{error || snapshot?.error}</div> : null}
    {snapshot?.truncated ? <div role="status" className="text-xs text-secondary-text">Older output was discarded. The last 256 KiB of each stream is retained.</div> : null}
    <div className="min-h-0 flex-1 overflow-auto bg-editor-bg p-2 font-mono text-xs" aria-label="Command output"><pre className="whitespace-pre-wrap break-words">{snapshot?.stdout}</pre><pre className="whitespace-pre-wrap break-words text-accent">{snapshot?.stderr}</pre></div>
    {snapshot?.state === 'running' ? <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void send() }}><input aria-label="Command input" className="min-w-0 flex-1 border border-border bg-editor-bg px-2 py-1 text-xs" value={input} onChange={event => setInput(event.target.value)} placeholder="Send a line to this process" autoComplete="off" /><button type="submit" className="px-2 text-xs">Send input</button></form> : null}
    <div className="text-xs text-secondary-text">Commands continue while this page is closed. Interactive full-screen programs need a system terminal.</div>
  </section>
}
