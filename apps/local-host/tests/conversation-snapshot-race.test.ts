import { expect, test } from 'bun:test'
import { ConversationService } from '../src/conversation.ts'
import type { HarnessHistory } from '../src/runtime.ts'
import { LlmAttemptId } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

test('merges mux events that arrive while the latest history snapshot is opening', async () => {
  const history = deferred<{
    events: Array<{ event: { type: string; seq: number; time: number; data: unknown } }>
    hasMore: boolean
    projections: { asOfSeq: number; values: Record<string, unknown> }
  }>()
  const started = deferred<void>()
  const emitted: unknown[] = []
  const harness = {
    listSessions: async () => {
      started.resolve(undefined)
      return [{
        sessionId: 'session-race', updatedAt: 1, running: true, blank: false, cwd: '/workspace',
      }]
    },
    listWorkspaces: async () => ({
      items: [{
        workspaceId: 'workspace-race', path: '/workspace', title: 'Workspace',
        sessionIds: ['session-race'], createdAt: '', updatedAt: '',
      }],
      archivedSessionIds: [],
    }),
    history: async () => history.promise,
    listSubagents: async () => ({ entries: [] }),
  }
  const service = new ConversationService(harness as never, { emit: (event: unknown) => emitted.push(event) } as never)
  const opening = service.snapshot('session-race', { maxMessages: 400 })
  await started.promise

  const internal = service as unknown as {
    handleMux(rpcId: string, payload: Record<string, unknown>): void
    lastSeq: Map<string, number>
  }
  internal.handleMux('rpc-live', {
    type: 'session/event',
    sessionId: 'session-race',
    event: {
      type: 'user/message', seq: 2, time: 3, surfaceOp: 'append',
      data: {
        id: 'live-message', source: { kind: 'user' },
        content: [{ type: 'text', text: 'arrived while opening' }],
      },
    },
  })
  history.resolve({
    events: [
      { event: { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } },
      { event: { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } } },
    ],
    hasMore: false,
    projections: { asOfSeq: 1, values: {} },
  })

  const snapshot = await opening
  expect(snapshot.items).toMatchObject([{
    kind: 'message', id: 'message:2', seq: 2, turn: 1, step: 1,
    content: [{ type: 'text', text: 'arrived while opening' }],
  }])
  expect(snapshot.lastSeq).toBe(2)
  expect(internal.lastSeq.get('session-race')).toBe(2)
})

test('merges transient chunks around a history baseline without duplicating or advancing durable history', async () => {
  const history = deferred<HarnessHistory>()
  const started = deferred<void>()
  const service = new ConversationService({
    listSessions: async () => [{ sessionId: 'stream-race', updatedAt: 1, running: true, blank: false }],
    listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
    history: async () => { started.resolve(); return history.promise },
  } as never, { emit: () => {} } as never)
  const opening = service.snapshot('stream-race')
  await started.promise
  const internal = service as unknown as { handleMux(rpcId: string, payload: Record<string, unknown>): void }
  const attemptId = LlmAttemptId('stream-race-attempt')
  for (const frame of [
    { type: 'start', attemptId, revision: 1, startedAfterSeq: 1, turn: 1, step: 1 },
    { type: 'chunk', attemptId, revision: 2, index: 0, time: 3, chunk: { type: 'text-delta', index: 0, text: 'hello' } },
    { type: 'chunk', attemptId, revision: 3, index: 1, time: 4, chunk: { type: 'text-delta', index: 0, text: ' world' } },
  ]) internal.handleMux('', { type: 'session/assistant-stream', sessionId: 'stream-race', frame })
  history.resolve({
    events: [
      { event: { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } },
      { event: { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } } },
    ],
    hasMore: false,
    assistantStream: { revision: 2, activeAttempt: {
      attemptId, turn: 1, step: 1, startedAfterSeq: SessionSeq(1), nextIndex: 1,
      stream: [{ type: 'text-chunks', time0: 3, index: 0, dt: [], texts: ['hello'] }],
    } },
  })
  const snapshot = await opening
  expect(snapshot.lastSeq).toBe(1)
  expect(snapshot.items).toMatchObject([{ kind: 'assistant', status: 'running', blocks: [{ type: 'text', text: 'hello world' }] }])
})
