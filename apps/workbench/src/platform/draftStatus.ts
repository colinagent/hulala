export type DraftStatus = 'pending' | 'persisted' | 'failed'
const states = new Map<string, DraftStatus>()
const listeners = new Set<() => void>()
export const getDraftStatus = (id: string) => states.get(id) || 'pending'
export const subscribeDraftStatus = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function setDraftStatus(id: string, status: DraftStatus): void {
  states.set(id, status)
  listeners.forEach(listener => listener())
}
