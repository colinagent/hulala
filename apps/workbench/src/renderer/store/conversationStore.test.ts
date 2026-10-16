import { expect, test } from 'bun:test'
import type { ConversationSnapshot } from '@hulala/workbench-contracts'
import { createConversationStore } from './conversationStore'

function snapshot(text: string, seq: number, epoch = 'first-host'): ConversationSnapshot {
  return {
    transportCursor: { epoch, seq },
    session: { sessionId: 'test-session', title: 'Test', updatedAt: 1, running: true, blank: false, archived: false },
    items: [{ id: 'assistant', kind: 'assistant', seq: 1, time: 1, turn: 0, step: 0, status: 'running', blocks: [{ type: 'text', text }] }],
    hasMore: false, firstSeq: 1, lastSeq: 1, queue: [], pendingInteractions: [], projections: { asOfSeq: 1, values: {} },
  }
}
function chunk(text: string, seq: number, epoch = 'first-host') {
  return { type: 'conversation.delta', sessionId: 'test-session', seq: 1, transient: true,
    transportCursor: { epoch, seq }, changes: [{ op: 'assistant-chunk', id: 'assistant', anchorSeq: 1, anchorTime: 1, turn: 0, step: 0, index: 0, chunk: { type: 'text-delta', text } }] }
}
function open(store: ReturnType<typeof createConversationStore>, value: ConversationSnapshot) {
  store.getState().applyOpen({ sessionId: value.session.sessionId, sessions: [value.session], snapshot: value })
}
function text(store: ReturnType<typeof createConversationStore>) {
  const item = store.getState().snapshots['test-session']!.items[0]!
  return item.kind === 'assistant' && item.blocks[0]?.type === 'text' ? item.blocks[0].text : ''
}

test('replays only stream updates newer than an arriving snapshot and ignores duplicate frames', () => {
  const store = createConversationStore()
  open(store, snapshot('Old view', 2))
  store.getState().applyServerEvent(chunk('lo', 11))
  open(store, snapshot('Hel', 10))
  expect(text(store)).toBe('Hello')
  store.getState().applyServerEvent(chunk('lo', 11))
  expect(text(store)).toBe('Hello')
  open(store, snapshot('Hel', 10))
  expect(text(store)).toBe('Hello')
})

test('holds new-Host stream data until its matching snapshot arrives', () => {
  const store = createConversationStore()
  open(store, snapshot('Old host', 90))
  store.getState().applyServerEvent(chunk('!', 5, 'second-host'))
  expect(text(store)).toBe('Old host')
  open(store, snapshot('New host', 4, 'second-host'))
  expect(text(store)).toBe('New host!')
})

test('reconnect discards inactive cached histories so opening them fetches a fresh baseline', () => {
  const store = createConversationStore()
  open(store, snapshot('Stale view', 5))
  store.getState().closeSession('test-session')
  store.getState().applyServerEvent({ type: 'conversation.reset', reason: 'reconnected', transportCursor: { epoch: 'first-host', seq: 7 } })
  expect(store.getState().snapshots).toEqual({})
})

test('refreshing an active session keeps its model and permission projections visible until replacement arrives', () => {
  const store = createConversationStore()
  const previous = snapshot('Still visible', 5)
  previous.projections.values.permissions = { currentValue: 'workspace-write', options: ['workspace-write', 'read-only'] }
  open(store, previous)
  store.getState().applyServerEvent({ type: 'conversation.reset', reason: 'reconnected', transportCursor: { epoch: 'first-host', seq: 7 } })
  expect(store.getState().snapshots['test-session']?.projections).toEqual(previous.projections)
  expect(text(store)).toBe('Still visible')
})
test('a baseline older than the bounded replay buffer requests a fresh snapshot instead of losing text', () => {
  const store = createConversationStore()
  open(store, snapshot('Initial', 0))
  for (let seq = 1; seq <= 2050; seq++) store.getState().applyServerEvent(chunk('.', seq))
  open(store, snapshot('Too old', 1))
  expect(store.getState().resyncRevision).toBe(1)
  expect(text(store)).not.toStartWith('Too old')
  open(store, snapshot('Authoritative', 2050))
  expect(text(store)).toBe('Authoritative')
  open(store, snapshot('Older HTTP response', 2049))
  expect(text(store)).toBe('Authoritative')
})
