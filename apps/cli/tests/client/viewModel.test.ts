import { expect, test } from 'bun:test'
import { ViewModelReducer, textOf, usageOf } from '../../src/tui/data/viewModel.js'

function event(type: string, data: unknown, seq = 1): Parameters<ViewModelReducer['applyEvent']>[0] {
  return { type, seq, time: 0, data }
}

test('reduces user and assistant messages', () => {
  const reducer = new ViewModelReducer()
  reducer.applyEvent(event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }))
  reducer.applyEvent(event('assistant/message', { message: { content: [{ type: 'text', text: 'world' }] } }, 2))
  expect(reducer.items).toEqual([
    { kind: 'user', text: 'hello', time: 0 },
    { kind: 'assistant', text: 'world', streaming: false, time: 0 },
  ])
})

test('streaming deltas append to one assistant item and finalize on message', () => {
  const reducer = new ViewModelReducer()
  reducer.applyDelta('one')
  reducer.applyDelta(' two')
  expect(reducer.items[reducer.items.length - 1]).toMatchObject({ kind: 'assistant', text: 'one two', streaming: true })
  reducer.endStream()
  expect(reducer.streaming).toBe(false)
  reducer.applyEvent(event('assistant/message', { message: { content: [] }, usage: { inputTokens: 10, outputTokens: 5 } }))
  expect(reducer.items[reducer.items.length - 1]).toMatchObject({ kind: 'assistant', streaming: false })
  expect(reducer.metrics.inputTokens).toBe(10)
})

test('tool call and result merge into one card', () => {
  const reducer = new ViewModelReducer()
  reducer.applyEvent(event('tool/call', { callId: 'c1', name: 'bash', arguments: 'ls' }))
  reducer.applyEvent(event('tool/result', { message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'file.txt' }] } }, 2))
  expect(reducer.items).toHaveLength(1)
  expect(reducer.items[0]).toMatchObject({ kind: 'tool', name: 'bash', status: 'ok', result: 'file.txt' })
})

test('counts steps and distinct turns from step/end events', () => {
  const reducer = new ViewModelReducer()
  reducer.applyEvent(event('step/end', { turn: 1, step: 1 }))
  reducer.applyEvent(event('step/end', { turn: 1, step: 2 }))
  reducer.applyEvent(event('step/end', { turn: 2, step: 1 }))
  expect(reducer.steps).toBe(3)
  expect(reducer.turns).toBe(2) // only turns that carried a step
})

test('records context pressure from the projection', () => {
  const reducer = new ViewModelReducer()
  reducer.setContextPressure(64_000, 128_000)
  expect(reducer.metrics.contextTokens).toBe(64_000)
  expect(reducer.metrics.contextLimit).toBe(128_000)
})

test('turn end errors and unknown events are handled safely', () => {
  const reducer = new ViewModelReducer()
  reducer.applyEvent(event('turn/end', { reason: { kind: 'error', error: { message: 'boom' } } }))
  expect(reducer.items[reducer.items.length - 1]).toEqual({ kind: 'error', message: 'boom', time: 0 })
  reducer.applyEvent(event('some/unknown', {}))
  expect(reducer.items).toHaveLength(1)
})

test('textOf joins text blocks and usageOf reads usage', () => {
  expect(textOf([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\nb')
  expect(usageOf({ usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 } })).toEqual({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 })
  expect(usageOf({})).toBeUndefined()
})

test('reasoning deltas stream into one block that the answer seals', () => {
  const reducer = new ViewModelReducer()
  reducer.applyReasoningDelta('The user asks ')
  reducer.applyReasoningDelta('how the project is going.')
  expect(reducer.items).toEqual([
    { kind: 'reasoning', text: 'The user asks how the project is going.', streaming: true, time: expect.any(Number) },
  ])
  reducer.applyDelta('Looking good.')
  expect(reducer.items).toMatchObject([
    { kind: 'reasoning', streaming: false },
    { kind: 'assistant', text: 'Looking good.', streaming: true },
  ])
})

test('history replay restores reasoning ahead of the answer', () => {
  const reducer = new ViewModelReducer()
  reducer.applyEvent(event('assistant/message', {
    message: {
      content: [
        { type: 'reasoning', text: 'check the repo' },
        { type: 'text', text: 'the repo is clean' },
      ],
    },
  }))
  expect(reducer.items).toEqual([
    { kind: 'reasoning', text: 'check the repo', streaming: false, time: 0 },
    { kind: 'assistant', text: 'the repo is clean', streaming: false, time: 0 },
  ])
})

test('tool results keep the failure code and the stop payload', () => {
  const reducer = new ViewModelReducer()
  reducer.applyEvent(event('tool/call', { callId: 'c1', name: 'bash', arguments: '{"command":"sleep 9"}' }))
  reducer.applyEvent(event('tool/result', {
    message: { toolCallId: 'c1', isError: true, content: [{ type: 'text', text: 'interrupted by the user' }] },
    error: { code: 'interrupted' },
    meta: { cwd: '/work' },
  }, 2))
  expect(reducer.items[0]).toMatchObject({
    kind: 'tool',
    status: 'stopped',
    errorCode: 'interrupted',
    meta: { cwd: '/work' },
    result: 'interrupted by the user',
  })
})

test('a stopped payload alone marks the call stopped', () => {
  const reducer = new ViewModelReducer()
  reducer.applyEvent(event('tool/call', { callId: 'c1', name: 'edit', arguments: '{}' }))
  reducer.applyEvent(event('tool/result', {
    message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'wrote 1 of 2 files' }] },
    meta: { stopped: true },
  }, 2))
  expect(reducer.items[0]).toMatchObject({ kind: 'tool', status: 'stopped' })
})

test('turn events bracket the running clock', () => {
  const reducer = new ViewModelReducer()
  reducer.applyEvent(event('turn/start', {}, 3))
  expect(reducer.busy).toBe(true)
  // The durable event time when it carries one, the wall clock otherwise.
  expect(reducer.turnStartedAt).toBeGreaterThan(0)
  reducer.applyEvent(event('turn/end', { reason: { kind: 'stop' } }, 4))
  expect(reducer.busy).toBe(false)
  expect(reducer.turnStartedAt).toBeUndefined()
})

test('a status-only run still gets a start time for the clock', () => {
  const reducer = new ViewModelReducer()
  reducer.setRunning(true)
  expect(reducer.turnStartedAt).toBeGreaterThan(0)
  reducer.setRunning(false)
  expect(reducer.turnStartedAt).toBeUndefined()
})

test('a durable message settles the streamed attempt instead of repeating it', () => {
  const reducer = new ViewModelReducer()
  reducer.applyReasoningDelta('the user said hello')
  reducer.applyDelta('Hello! What would you like to work on?')
  reducer.endStream() // the assistant-stream `end` frame
  reducer.applyEvent(event('assistant/message', {
    message: {
      content: [
        { type: 'reasoning', text: 'the user said hello' },
        { type: 'text', text: 'Hello! What would you like to work on?' },
      ],
    },
  }, 2))
  expect(reducer.items).toMatchObject([
    { kind: 'reasoning', text: 'the user said hello', streaming: false },
    { kind: 'assistant', text: 'Hello! What would you like to work on?', streaming: false },
  ])
  expect(reducer.items).toHaveLength(2)
})

test('a durable message fills a streamed attempt that had no deltas left', () => {
  const reducer = new ViewModelReducer()
  reducer.applyReasoningDelta('thinking')
  reducer.endStream()
  reducer.applyEvent(event('assistant/message', {
    message: { content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'answer' }] },
  }, 2))
  expect(reducer.items).toMatchObject([
    { kind: 'reasoning', text: 'thinking', streaming: false },
    { kind: 'assistant', text: 'answer', streaming: false },
  ])
})

test('consecutive attempts do not merge into one another', () => {
  const reducer = new ViewModelReducer()
  reducer.applyReasoningDelta('first')
  reducer.applyDelta('one')
  reducer.endStream()
  reducer.applyEvent(event('assistant/message', { message: { content: [{ type: 'text', text: 'one' }] } }, 2))
  reducer.applyReasoningDelta('second')
  reducer.applyDelta('two')
  reducer.endStream()
  reducer.applyEvent(event('assistant/message', { message: { content: [{ type: 'text', text: 'two' }] } }, 4))
  expect(reducer.items.map(item => item.kind)).toEqual(['reasoning', 'assistant', 'reasoning', 'assistant'])
  expect(reducer.items[3]).toMatchObject({ kind: 'assistant', text: 'two', streaming: false })
})

test('a truncated stream is completed from the durable message', () => {
  const reducer = new ViewModelReducer()
  reducer.applyDelta('Hello! What would')
  reducer.endStream()
  reducer.applyEvent(event('assistant/message', {
    message: { content: [{ type: 'text', text: 'Hello! What would you like to work on?' }] },
  }, 2))
  expect(reducer.items).toMatchObject([
    { kind: 'assistant', text: 'Hello! What would you like to work on?', streaming: false },
  ])
})

test('mirrors both durable pending lists and drops one when the Host claims it', () => {
  const reducer = new ViewModelReducer()
  reducer.setInbox({
    steering: [{ id: 's1', text: 'steer this' }],
    followUp: [{ id: 'q1', text: 'then that' }],
  })
  expect(reducer.pendingCount).toBe(2)
  // The claim is logged before the projection publishes its removal, so the
  // durable message is what takes the row out of the pending block.
  reducer.applyEvent(event('user/message', { id: 's1', source: { kind: 'user' }, content: [{ type: 'text', text: 'steer this' }] }))
  expect(reducer.pending).toEqual({ steering: [], followUp: [{ id: 'q1', text: 'then that' }] })
  expect(reducer.items).toEqual([{ kind: 'user', text: 'steer this', time: 0 }])
  reducer.reset()
  expect(reducer.pendingCount).toBe(0)
})

test('keeps a pending occurrence that carries no text', () => {
  const reducer = new ViewModelReducer()
  reducer.setInbox({ steering: [], followUp: [{ id: 'image-1' }] })
  expect(reducer.pending.followUp).toEqual([{ id: 'image-1' }])
})
