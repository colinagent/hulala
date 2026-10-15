import type { JournalReply, JournalRequest } from './journal'

let database: IDBDatabase | undefined
let queue = Promise.resolve()
const send = (value: JournalReply) => (self as unknown as { postMessage(value: JournalReply): void }).postMessage(value)
const open = (workspaceId: string): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open('hulala.drafts.' + workspaceId, 1)
  request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' })
  request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
  request.onerror = request.onblocked = () => reject(request.error || new Error('Browser draft storage is blocked'))
})
const transaction = (input: JournalRequest): Promise<unknown> => new Promise((resolve, reject) => {
  if (!database) { reject(new Error('Browser draft storage is not open')); return }
  const tx = database.transaction('drafts', input.method === 'read' ? 'readonly' : 'readwrite')
  const store = tx.objectStore('drafts')
  const request = input.method === 'read' ? store.getAll() : input.method === 'put' ? store.put(input.entry) : store.delete(input.key!)
  tx.oncomplete = () => resolve(request.result)
  tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error('Draft storage failed'))
})
self.addEventListener('message', ({ data }: MessageEvent<JournalRequest>) => {
  queue = queue.then(async () => {
    try {
      if (data.method === 'open') { database?.close(); database = await open(data.workspaceId!); send({ id: data.id, ok: true }) }
      else send({ id: data.id, ok: true, value: await transaction(data) })
    } catch (error) { send({ id: data.id, ok: false, error: error instanceof Error ? error.message : 'Browser draft storage failed' }) }
  })
})
