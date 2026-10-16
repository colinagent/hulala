import { expect, test } from 'bun:test'
import { resilientStorage } from './storage'

test('blocked browser storage retains current view state in memory and reports the limitation', () => {
  let warnings = 0
  const storage = resilientStorage(() => { throw new DOMException('blocked', 'SecurityError') }, () => warnings++)
  storage.setItem('draft-view', 'first')
  expect(storage.getItem('draft-view')).toBe('first')
  storage.setItem('draft-view', 'second')
  expect(storage.length).toBe(1)
  expect(storage.key(0)).toBe('draft-view')
  storage.removeItem('draft-view')
  expect(storage.getItem('draft-view')).toBeNull()
  expect(warnings).toBe(1)
})

test('quota failure preserves previously stored preferences alongside new in-memory values', () => {
  const native = resilientStorage(() => undefined, () => {})
  native.setItem('saved', 'value')
  let warnings = 0
  const storage = resilientStorage(() => ({ ...native, get length() { return native.length }, setItem() { throw new DOMException('full', 'QuotaExceededError') } }), () => warnings++)
  storage.setItem('new', 'temporary')
  expect(storage.getItem('saved')).toBe('value')
  expect(storage.getItem('new')).toBe('temporary')
  expect(warnings).toBe(1)
})
