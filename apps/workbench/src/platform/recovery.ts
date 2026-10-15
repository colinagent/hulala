import { sessionStore, reportStorageIssue } from "./storage";
import type { WorkbenchPlatform } from '../renderer/types/platform'
import type { RecoveryBackupIdentity, RecoveryBackupInput, RecoveryBackupRecord } from '../shared/recoveryBackup'
import { setDraftStatus } from './draftStatus'

type JournalEntry = { key: string; identity: RecoveryBackupIdentity; record?: RecoveryBackupRecord }
type JsonRequest = <T = any>(url: string, init?: RequestInit) => Promise<T>
const requestBody = (value: unknown, method: string): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
const keyFor = (identity: RecoveryBackupIdentity) => identity.workspaceTabId + ':' + identity.id

async function openJournal(workspaceId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('hulala.drafts.' + workspaceId, 1)
    let settled = false
    const timeout = setTimeout(() => { settled = true; reject(new Error('Browser draft storage did not respond')) }, 2500)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' })
    request.onsuccess = () => { if (settled) { request.result.close(); return }; settled = true; clearTimeout(timeout); resolve(request.result) }
    request.onerror = request.onblocked = () => { settled = true; clearTimeout(timeout); reject(request.error || new Error('Browser draft storage is blocked')) }
  })
}

function transaction<T>(db: IDBDatabase, write: boolean, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', write ? 'readwrite' : 'readonly')
    const request = action(tx.objectStore('drafts'))
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error('Draft storage failed'))
  })
}

export async function createBrowserRecovery(workspaceId: string, prefix: string, json: JsonRequest): Promise<{ viewId: string; backup: WorkbenchPlatform['backup'] }> {
  const sessionKey = 'hulala.view-id.' + workspaceId
  const lockPrefix = 'hulala.view.' + workspaceId + '.'
  let viewId = sessionStore.getItem(sessionKey) || crypto.randomUUID()
  const acquire = (id: string) => new Promise<boolean>((resolve, reject) => {
    void navigator.locks.request(lockPrefix + id, { ifAvailable: true }, async lock => {
      resolve(Boolean(lock))
      if (lock) await new Promise<void>(() => { /* The browser releases this lease when the document dies. */ })
    }).catch(reject)
  })
  let locksAvailable = false
  try {
    if (navigator.locks) {
      if (!await acquire(viewId)) { viewId = crypto.randomUUID(); await acquire(viewId) }
      locksAvailable = true
    }
  } catch { /* The Host also tracks active views across browser profiles. */ }
  if (!locksAvailable) { viewId = crypto.randomUUID(); reportStorageIssue('preferences') }
  sessionStore.setItem(sessionKey, viewId)
  await json(prefix + '/views', requestBody({ viewId }, 'POST'))
  let db: IDBDatabase | undefined
  try { db = await openJournal(workspaceId) } catch { reportStorageIssue('drafts') }
  const memoryJournal = new Map<string, JournalEntry>()
  const unavailable = () => { try { db?.close() } catch {}; db = undefined; reportStorageIssue('drafts') }
  const putLocal = async (entry: JournalEntry) => { memoryJournal.set(entry.key, entry); if (db) try { await transaction(db, true, store => store.put(entry)) } catch { unavailable() } }
  const deleteLocal = async (key: string) => { memoryJournal.delete(key); if (db) try { await transaction(db, true, store => store.delete(key)) } catch { unavailable() } }
  const readLocal = async (): Promise<JournalEntry[]> => {
    if (db) try {
      const entries = await transaction(db, false, store => store.getAll()) as JournalEntry[]
      for (const entry of entries) if (!memoryJournal.has(entry.key)) memoryJournal.set(entry.key, entry)
      return entries
    } catch { unavailable() }
    return [...memoryJournal.values()]
  }
  const pending = new Map<string, JournalEntry>()
  const drafts = new Map<string, RecoveryBackupRecord>()
  const removed = new Set<string>()
  let initialLoad: Promise<void> | undefined
  let localQueue = Promise.resolve()
  let networkQueue = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined
  let failure: unknown
  const report = (error: unknown) => {
    failure = error
    for (const entry of pending.values()) setDraftStatus(entry.identity.id, 'failed')
    window.dispatchEvent(new CustomEvent('hulala:notice', { detail: 'Draft backup failed. Keep this tab open and retry saving. ' + (error instanceof Error ? error.message : '') }))
  }
  const flush = async () => {
    clearTimeout(timer)
    const upload = networkQueue.catch(() => undefined).then(async () => {
      await localQueue
      while (pending.size) {
        for (const [key, entry] of [...pending]) {
          await json(prefix + '/drafts', requestBody(entry.record || entry.identity, entry.record ? 'PUT' : 'DELETE'))
          if (pending.get(key) === entry) {
            pending.delete(key)
            setDraftStatus(entry.identity.id, 'persisted')
            if (!entry.record) await deleteLocal(key)
          }
        }
      }
      failure = undefined
    })
    networkQueue = upload
    await upload
    return { persisted: true }
  }
  const enqueue = (entry: JournalEntry) => {
    setDraftStatus(entry.identity.id, 'pending')
    pending.set(entry.key, entry)
    localQueue = localQueue.catch(() => undefined).then(() => putLocal(entry))
    void localQueue.catch(report)
    clearTimeout(timer)
    timer = setTimeout(() => { void flush().catch(report) }, 200)
  }
  window.addEventListener('beforeunload', event => {
    if (drafts.size || pending.size || failure) { event.preventDefault(); event.returnValue = '' }
  })
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flush().catch(report) })

  const backup: WorkbenchPlatform['backup'] = {
    stage(data: RecoveryBackupInput) {
      const record = { ...data, workspaceTabId: viewId, timestamp: Date.now() }
      const key = keyFor(record)
      removed.delete(key)
      drafts.set(key, record)
      enqueue({ key, identity: { workspaceTabId: viewId, id: data.id }, record })
    },
    flush,
    async load() {
      if (!initialLoad) initialLoad = (async () => {
      await localQueue
      let hostViews = await json<{ activeViews: string[]; recoveryWaitMs?: number }>(prefix + '/views?viewId=' + encodeURIComponent(viewId))
      // A restarting Host gives still-open views time to reconnect. Waiting only
      // applies to owners with durable drafts, and never to this view's own ID.
      const deadline = Date.now() + 31000
      while ((hostViews.recoveryWaitMs || 0) > 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, Math.min(500, hostViews.recoveryWaitMs!)))
        hostViews = await json(prefix + '/views?viewId=' + encodeURIComponent(viewId))
      }
      let locks: LockManagerSnapshot = { held: [] }
      if (locksAvailable) try { locks = await navigator.locks.query() } catch { /* Host leases remain authoritative. */ }
      const activeViews = [...new Set([...hostViews.activeViews, ...(locks.held || []).map(lock => lock.name || '').filter(name => name.startsWith(lockPrefix)).map(name => name.slice(lockPrefix.length))])].filter(id => id !== viewId)
      const local = await readLocal()
      const restorable = local.filter(entry => !activeViews.includes(entry.identity.workspaceTabId))
      for (const entry of restorable) if (!pending.has(entry.key)) pending.set(entry.key, entry)
      await flush()
      const records = await json<RecoveryBackupRecord[]>(prefix + '/drafts/restore', requestBody({ viewId, activeViews }, 'POST'))
      for (const record of records) {
        const key = keyFor(record)
        if (removed.has(key) || (drafts.get(key)?.contentVersion ?? -1) > record.contentVersion) continue
        setDraftStatus(record.id, 'persisted')
        drafts.set(key, record)
        await putLocal({ key, identity: { workspaceTabId: viewId, id: record.id }, record })
      }
      // Remove the old owners only after the Host and this view have durable copies.
      for (const entry of restorable) if (entry.identity.workspaceTabId !== viewId) await deleteLocal(entry.key)
      })().catch(error => { initialLoad = undefined; throw error })
      await initialLoad
      return [...drafts.values()]
    },
    async delete(identity) {
      const owned = { ...identity, workspaceTabId: viewId }
      const key = keyFor(owned)
      removed.add(key)
      drafts.delete(key)
      enqueue({ key, identity: owned })
      await flush()
      return { deleted: true }
    },
  }
  return { viewId, backup }
}
