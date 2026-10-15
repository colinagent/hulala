import type { RecoveryBackupIdentity, RecoveryBackupRecord } from '../shared/recoveryBackup'

export type JournalEntry = { key: string; identity: RecoveryBackupIdentity; record?: RecoveryBackupRecord }
export type JournalRequest = { id: number; method: 'open' | 'read' | 'put' | 'delete'; workspaceId?: string; entry?: JournalEntry; key?: string }
export type JournalReply = { id: number; ok: true; value?: unknown } | { id: number; ok: false; error: string }
export interface BrowserJournal { read(): Promise<JournalEntry[]>; put(entry: JournalEntry): Promise<void>; delete(key: string): Promise<void>; close(): void }

/** IndexedDB initialization can block Firefox's main thread on a new profile. */
export async function openBrowserJournal(workspaceId: string): Promise<BrowserJournal> {
  if (typeof Worker === 'undefined') throw new Error('Browser draft storage is unavailable')
  const worker = new Worker(new URL('./journal.worker.ts', import.meta.url), { type: 'module' })
  let next = 0, closed = false
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const close = () => {
    if (closed) return
    closed = true; worker.terminate(); window.removeEventListener('pagehide', leave)
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Browser draft storage stopped')) }
    pending.clear()
  }
  const leave = (event: PageTransitionEvent) => { if (!event.persisted) close() }
  window.addEventListener('pagehide', leave)
  worker.onerror = close
  worker.onmessage = ({ data }: MessageEvent<JournalReply>) => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id); clearTimeout(request.timer)
    if (data.ok) request.resolve(data.value)
    else request.reject(new Error(data.error))
  }
  const call = <T>(input: Omit<JournalRequest, 'id'>): Promise<T> => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('Browser draft storage is unavailable')); return }
    const id = ++next
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Browser draft storage did not respond')) }, 2500)
    pending.set(id, { resolve: value => resolve(value as T), reject, timer })
    try { worker.postMessage({ ...input, id }) }
    catch (error) { pending.delete(id); clearTimeout(timer); reject(error) }
  })
  try { await call({ method: 'open', workspaceId }) }
  catch (error) { close(); throw error }
  return { read: () => call({ method: 'read' }), put: entry => call({ method: 'put', entry }), delete: key => call({ method: 'delete', key }), close }
}
