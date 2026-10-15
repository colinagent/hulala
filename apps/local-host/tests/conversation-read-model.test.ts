import { expect, test } from 'bun:test'
import { HarnessConversationReadModel } from '../src/conversationReadModel.ts'
import { LlmAttemptId } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'

test('restores the active stream baseline, ignores duplicate chunks, and settles interrupted output', () => {
  const model = new HarnessConversationReadModel()
  const attemptId = LlmAttemptId('attempt-reconnect')
  expect(model.restoreAssistantStream({ revision: 2, activeAttempt: {
    attemptId, turn: 1, step: 1, startedAfterSeq: SessionSeq(3), nextIndex: 1,
    stream: [{ type: 'text-chunks', time0: 10, index: 0, dt: [], texts: ['hello'] }],
  } })).toMatchObject([{ op: 'assistant-chunk', chunk: { text: 'hello' } }])
  const chunk = { type: 'chunk' as const, attemptId, revision: 3, index: 1, time: 11,
    chunk: { type: 'text-delta', index: 0, text: ' world' } }
  expect(model.applyAssistantStream(chunk)).toMatchObject([{ op: 'assistant-chunk', chunk: { text: ' world' } }])
  expect(model.applyAssistantStream(chunk)).toEqual([])
  expect(model.apply({ type: 'assistant/message', seq: 4, time: 12, surfaceOp: 'append',
    data: { turn: 1, step: 1, interrupted: true, stream: [], message: { content: [{ type: 'text', text: 'hello world' }] } },
  })).toMatchObject([{ op: 'upsert', item: { status: 'interrupted', blocks: [{ type: 'text', text: 'hello world' }] } }])
  expect(model.applyAssistantStream({ type: 'end', attemptId, revision: 4, index: 2,
    outcome: { kind: 'committed', eventType: 'assistant/message', seq: 4 },
  })).toEqual([])
})

test('withdraws failed and abandoned assistant attempts without fabricating history', () => {
  const model = new HarnessConversationReadModel()
  const attemptId = LlmAttemptId('attempt-failed')
  model.applyAssistantStream({ type: 'start', attemptId, revision: 1, startedAfterSeq: SessionSeq(0), turn: 1, step: 1 })
  model.applyAssistantStream({ type: 'chunk', attemptId, revision: 2, index: 0, time: 1, chunk: { type: 'text-delta', index: 0, text: 'draft' } })
  expect(model.apply({ type: 'assistant/attempt', seq: 1, time: 2, data: { turn: 1, step: 1, stream: [] } }))
    .toEqual([{ op: 'remove', id: 'assistant:1:1' }])
  expect(model.applyAssistantStream({ type: 'end', attemptId, revision: 3, index: 1, outcome: { kind: 'abandoned' } }))
    .toEqual([{ op: 'remove', id: 'assistant:1:1' }])
})

test('folds streamed Assistant blocks into one stable step and settles it in place', () => {
  const readModel = new HarnessConversationReadModel()
  expect(readModel.apply({
    type: 'assistant/stream-chunk', seq: 1, time: 10,
    data: { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'Hel' } },
  })).toEqual([{
    op: 'assistant-chunk', id: 'assistant:0:0', anchorSeq: 1, anchorTime: 10,
    turn: 0, step: 0, index: 0, chunk: { type: 'text-delta', text: 'Hel' },
  }])
  expect(readModel.apply({
    type: 'assistant/stream-chunk', seq: 2, time: 11,
    data: { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'lo' } },
  })).toEqual([{
    op: 'assistant-chunk', id: 'assistant:0:0', anchorSeq: 1, anchorTime: 10,
    turn: 0, step: 0, index: 0, chunk: { type: 'text-delta', text: 'lo' },
  }])
  expect(readModel.apply({
    type: 'assistant/message', seq: 3, time: 12, surfaceOp: 'append',
    data: { turn: 0, step: 0, message: { id: 'message-1', content: [{ type: 'text', text: 'Hello' }] } },
  })).toEqual([{ op: 'upsert', item: {
    kind: 'assistant', id: 'assistant:0:0', seq: 1, time: 10, turn: 0, step: 0,
    messageId: 'message-1', status: 'settled', blocks: [{ type: 'text', text: 'Hello' }],
  } }])
})

test('pairs a tool call and result without exposing raw Harness envelopes', () => {
  const readModel = new HarnessConversationReadModel()
  readModel.apply({
    type: 'tool/call', seq: 4, time: 20,
    data: { callId: 'call-1', name: 'bash', arguments: '{"command":"pwd"}' },
  })
  const result = readModel.apply({
    type: 'tool/result', seq: 5, time: 21, surfaceOp: 'append',
    data: { message: { callId: 'call-1', isError: false, content: [{ type: 'text', text: '/workspace' }] } },
  })
  expect(result).toMatchObject([{ op: 'upsert', item: {
    kind: 'tool', turn: 0, step: 0, callId: 'call-1', name: 'bash', status: 'done', resultText: '/workspace',
  } }])
})

test('keeps streamed reasoning and text in their Harness block-index order', () => {
  const readModel = new HarnessConversationReadModel()
  readModel.apply({
    type: 'assistant/stream-chunk', seq: 30, time: 100,
    data: { turn: 4, step: 2, chunk: { type: 'reasoning-delta', index: 0, text: 'think' } },
  })
  const result = readModel.apply({
    type: 'assistant/stream-chunk', seq: 31, time: 101,
    data: { turn: 4, step: 2, chunk: { type: 'text-delta', index: 1, text: 'answer' } },
  })

  expect(result).toEqual([{
    op: 'assistant-chunk', id: 'assistant:4:2', anchorSeq: 30, anchorTime: 100,
    turn: 4, step: 2, index: 1, chunk: { type: 'text-delta', text: 'answer' },
  }])
})

test('withdraws a failed retry attempt and closes a later partial as interrupted', () => {
  const readModel = new HarnessConversationReadModel()
  readModel.apply({
    type: 'assistant/stream-chunk', seq: 40, time: 200,
    data: { turn: 5, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'failed attempt' } },
  })
  expect(readModel.apply({
    type: 'llm/retry', seq: 41, time: 201,
    data: { turn: 5, step: 1, failure: { message: 'retry' } },
  })).toMatchObject([
    { op: 'remove', id: 'assistant:5:1' },
    { op: 'upsert', item: { kind: 'notice', eventType: 'llm/retry' } },
  ])
  readModel.apply({
    type: 'assistant/stream-chunk', seq: 42, time: 202,
    data: { turn: 5, step: 1, chunk: { type: 'text-delta', index: 0, text: 'partial answer' } },
  })
  expect(readModel.apply({
    type: 'turn/end', seq: 43, time: 203,
    data: { turn: 5, reason: { kind: 'aborted' } },
  })).toMatchObject([
    { op: 'upsert', item: {
      kind: 'assistant', id: 'assistant:5:1', seq: 42, status: 'interrupted',
      blocks: [{ type: 'text', text: 'partial answer' }],
    } },
    { op: 'upsert', item: { kind: 'notice', eventType: 'turn/end' } },
  ])
})

test('preserves Harness block order and turn ownership in the supplied regression shape', () => {
  const items = new HarnessConversationReadModel().snapshot([
    { event: { type: 'turn/start', seq: 13, time: 1, data: { turn: 1 } } },
    { event: { type: 'step/start', seq: 14, time: 1, data: { turn: 1, step: 1 } } },
    { event: {
      type: 'user/message', seq: 15, time: 1, surfaceOp: 'append',
      data: { id: 'user-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'draw it' }] },
    } },
    { event: {
      type: 'assistant/message', seq: 812, time: 2, surfaceOp: 'append',
      data: { turn: 1, step: 1, message: { id: 'assistant-1', content: [
        { type: 'reasoning', text: 'first thought' },
        { type: 'reasoning', text: 'second thought' },
        { type: 'text', text: 'first answer' },
      ] } },
    } },
    { event: { type: 'step/end', seq: 813, time: 2, data: { turn: 1, step: 1 } } },
    { event: { type: 'turn/end', seq: 814, time: 2, data: { turn: 1, reason: { kind: 'completed' } } } },
    { event: { type: 'turn/start', seq: 817, time: 3, data: { turn: 2 } } },
    { event: { type: 'step/start', seq: 818, time: 3, data: { turn: 2, step: 1 } } },
    { event: {
      type: 'user/message', seq: 819, time: 3, surfaceOp: 'append',
      data: { id: 'user-2', source: { kind: 'user' }, content: [{ type: 'text', text: 'next question' }] },
    } },
    { event: {
      type: 'assistant/message', seq: 843, time: 4, surfaceOp: 'append',
      data: { turn: 2, step: 1, message: { id: 'assistant-2', content: [{ type: 'text', text: 'next answer' }] } },
    } },
  ])

  expect(items.map(item => item.id)).toEqual([
    'message:15', 'assistant:1:1', 'message:819', 'assistant:2:1',
  ])
  expect(items[0]).toMatchObject({ kind: 'message', turn: 1, step: 1 })
  expect(items[1]).toMatchObject({
    kind: 'assistant', turn: 1, step: 1, status: 'settled',
    blocks: [
      { type: 'reasoning', text: 'first thought' },
      { type: 'reasoning', text: 'second thought' },
      { type: 'text', text: 'first answer' },
    ],
  })
  expect(items[2]).toMatchObject({ kind: 'message', turn: 2, step: 1 })
})

test('uses the stable Harness surface operation and hides replacement messages from the transcript', () => {
  expect(new HarnessConversationReadModel().apply({
    type: 'user/message', seq: 20, time: 50,
    surfaceOp: { op: 'replace', start: 1, end: 19 },
    data: { id: 'summary', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'compacted' }] },
  })).toEqual([])
})

test('projects native system messages and replaces or clears prior prompt nodes', () => {
  const readModel = new HarnessConversationReadModel()
  const data = { turn: 1, step: 1, message: { id: 'system-test', role: 'system', source: { kind: 'plugin', plugin: 'fixture' }, content: [{ type: 'text', text: 'Fixture prompt' }] } }
  expect(readModel.apply({ type: 'system/message', seq: 6, time: 22, surfaceOp: 'append', data })).toEqual([{ op: 'upsert', item: {
    kind: 'message', id: 'system-prompt:6', seq: 6, time: 22,
    role: 'system', sourceLabel: 'System prompt', turn: 1, step: 1,
    content: [{ type: 'text', text: 'Fixture prompt' }],
  } }])
  expect(readModel.apply({ type: 'system/message', seq: 8, time: 24, surfaceOp: { op: 'replace', start: 6, end: 6 }, data }))
    .toMatchObject([{ op: 'remove', id: 'system-prompt:6' }, { op: 'upsert', item: { id: 'system-prompt:8' } }])
  expect(readModel.apply({ type: 'system/message', seq: 9, time: 25, surfaceOp: { op: 'replace', start: 8, end: 8 }, data: { ...data, message: { ...data.message, content: [] } } }))
    .toEqual([{ op: 'remove', id: 'system-prompt:8' }])
})

test('marks unknown required events as an upgrade warning', () => {
  expect(new HarnessConversationReadModel().apply({ type: 'future/required', seq: 8, time: 30, data: {} }))
    .toMatchObject([{ op: 'upsert', item: { kind: 'notice', tone: 'warning', label: 'Unsupported Harness event' } }])
})

test('folds Harness command lifecycle into one activity row', () => {
  const readModel = new HarnessConversationReadModel()
  readModel.apply({ type: 'command/run', seq: 9, time: 40, data: { commandId: 'cmd-1', name: 'permission', args: 'read-only' } })
  expect(readModel.apply({ type: 'command/done', seq: 10, time: 41, data: { commandId: 'cmd-1', kind: 'success', text: 'preset read-only' } }))
    .toEqual([{ op: 'upsert', item: {
      kind: 'notice', id: 'command:cmd-1', seq: 9, time: 40, tone: 'success',
      label: '/permission', detail: 'preset read-only', eventType: 'command/done',
    } }])
})

test('a finalized empty or tool-only message removes its provisional assistant text', () => {
  for (const content of [[], [{ type: 'reasoning', text: '' }], [{ type: 'tool-call', id: 'call', name: 'read', arguments: '{}' }]]) {
    const model = new HarnessConversationReadModel()
    model.apply({ type: 'assistant/stream-chunk', seq: 1, time: 1, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'provisional' } } })
    expect(model.apply({ type: 'assistant/message', seq: 2, time: 2, surfaceOp: 'append', data: { turn: 1, step: 1, message: { content } } })).toEqual([
      { op: 'remove', id: 'assistant:1:1' },
    ])
  }
})

test('invalid stream indices produce a notice without overwriting valid blocks', () => {
  const model = new HarnessConversationReadModel()
  model.apply({ type: 'assistant/stream-chunk', seq: 1, time: 1, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'valid' } } })
  for (const index of [-1, 0.5, undefined, Number.MAX_SAFE_INTEGER]) {
    const changes = model.apply({ type: 'assistant/stream-chunk', seq: 2, time: 2, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index, text: 'incorrect' } } })
    expect(changes).toMatchObject([{ op: 'upsert', item: { kind: 'notice', tone: 'warning' } }])
  }
  const end = model.apply({ type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'aborted' } } })
  expect(end[0]).toMatchObject({ op: 'upsert', item: { blocks: [{ type: 'text', text: 'valid' }], status: 'interrupted' } })
})
