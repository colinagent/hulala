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
