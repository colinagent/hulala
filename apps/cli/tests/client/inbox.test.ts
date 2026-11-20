import { expect, test } from 'bun:test'
import { inboxOf } from '../../src/tui/data/remote.js'

test('narrows the inbox projection to the two lists the composer restores', () => {
  expect(inboxOf({
    'next-step': [
      { id: 's1', source: { kind: 'user' }, content: [{ type: 'text', text: 'steer ' }, { type: 'text', text: 'this' }] },
    ],
    'next-turn': [
      { id: 'q1', source: { kind: 'user' }, content: [{ type: 'text', text: 'then that' }] },
    ],
  })).toEqual({
    steering: [{ id: 's1', text: 'steer this' }],
    followUp: [{ id: 'q1', text: 'then that' }],
  })
})

test('an absent projection reads as an empty queue', () => {
  expect(inboxOf(undefined)).toEqual({ steering: [], followUp: [] })
  expect(inboxOf({})).toEqual({ steering: [], followUp: [] })
})

test('keeps non-text occurrences but leaves injected context out', () => {
  expect(inboxOf({
    'next-step': [
      // Injected context: durable, but never a prompt the composer owns.
      { id: 'ctx-1', source: { kind: 'context-injection' }, content: [{ type: 'text', text: '[context]' }] },
      // An image keeps its identity so the row can say it stayed queued.
      { id: 'image-1', source: { kind: 'user' }, content: [{ type: 'image', attachment: { attachmentId: 'a1' } }] },
    ],
    'next-turn': [],
  })).toEqual({
    steering: [{ id: 'image-1' }],
    followUp: [],
  })
})

test('a queued user-question-reply is reported by call id, not as a pending prompt', () => {
  // DSH Web reconciles `userQuestions` against the inbox and skips a
  // `continued` row whose reply is already queued. Without the call ids the
  // terminal would reopen a card the user has just submitted.
  expect(inboxOf({
    'next-step': [
      { id: 'r1', source: { kind: 'user-question-reply', callId: 'call-1' }, content: [{ type: 'text', text: 'Postgres' }] },
      { id: 's1', source: { kind: 'user' }, content: [{ type: 'text', text: 'also this' }] },
    ],
    'next-turn': [
      { id: 'r2', source: { kind: 'user-question-reply', callId: 'call-2' }, content: [{ type: 'text', text: 'SQLite' }] },
      { id: 'r3', source: { kind: 'user-question-reply' }, content: [] },
      // One call answered twice (two clients submitted before the row closed):
      // the set is what keeps the reconcile idempotent.
      { id: 'r4', source: { kind: 'user-question-reply', callId: 'call-1' }, content: [] },
    ],
  })).toEqual({
    steering: [{ id: 's1', text: 'also this' }],
    followUp: [],
    replies: ['call-1', 'call-2'],
  })
})

test('an inbox with no queued reply omits the reply list', () => {
  expect(inboxOf({
    'next-step': [{ id: 's1', source: { kind: 'user' }, content: [{ type: 'text', text: 'go on' }] }],
    'next-turn': [],
  })).toEqual({ steering: [{ id: 's1', text: 'go on' }], followUp: [] })
})
