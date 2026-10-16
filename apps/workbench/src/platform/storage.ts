export type StorageIssue = 'preferences' | 'drafts'
const issues = new Set<StorageIssue>()
const listeners = new Set<() => void>()
export function reportStorageIssue(issue: StorageIssue): void {
  if (issues.has(issue)) return
  issues.add(issue); listeners.forEach(listener => listener())
}
export const storageIssues = () => [...issues]
export function onStorageIssue(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }

/** An explicit memory fallback for browser view preferences, never file saving. */
export function resilientStorage(get: () => Storage | undefined, unavailable: () => void): Storage {
  const memory = new Map<string, string>()
  let memoryOnly = false
  const failed = (storage?: Storage) => {
    if (memoryOnly) return
    if (storage) try { for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (key !== null) { const value = storage.getItem(key); if (value !== null) memory.set(key, value) } } } catch {}
    memoryOnly = true; unavailable()
  }
  const native = () => { if (memoryOnly) return undefined; try { return get() } catch { failed(); return undefined } }
  return {
    get length() { const storage = native(); if (storage) try { return storage.length } catch { failed(storage) }; return memory.size },
    key(index) { const storage = native(); if (storage) try { return storage.key(index) } catch { failed(storage) }; return [...memory.keys()][index] ?? null },
    getItem(key) { const storage = native(); if (storage) try { const value = storage.getItem(key); if (value === null) memory.delete(key); else memory.set(key, value); return value } catch { failed(storage) }; return memory.get(key) ?? null },
    setItem(key, value) { const storage = native(); if (storage) try { storage.setItem(key, value) } catch { failed(storage) }; memory.set(String(key), String(value)) },
    removeItem(key) { const storage = native(); if (storage) try { storage.removeItem(key) } catch { failed(storage) }; memory.delete(key) },
    clear() { const storage = native(); if (storage) try { storage.clear() } catch { failed(storage) }; memory.clear() },
  }
}
export const localStore = resilientStorage(() => typeof window === 'undefined' ? undefined : window.localStorage, () => reportStorageIssue('preferences'))
export const sessionStore = resilientStorage(() => typeof window === 'undefined' ? undefined : window.sessionStorage, () => reportStorageIssue('preferences'))
