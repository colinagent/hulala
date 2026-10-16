import { expect, test } from 'bun:test'
import { ConversationService } from '../src/conversation'
import { createHarnessNotifications } from '../src/harnessNotifications'
import { parseJson } from '../src/http'
import { z } from 'zod'

test('concurrent retries deliver one prompt and conflicting reuse cannot alter its content', async () => {
  let finish!: () => void
  const pause = new Promise<void>(resolve => { finish = resolve })
  let calls = 0
  const service = new ConversationService({
    listSessions: async () => [{ sessionId: 'chat' }],
    prompt: async () => { calls++; await pause; return { accepted: true } },
  } as never, { emit() {} } as never)
  const input = { requestId: crypto.randomUUID(), mode: 'queue' as const, content: [{ type: 'text' as const, text: 'One logical message' }] }
  const first = service.prompt('chat', input)
  const retry = service.prompt('chat', structuredClone(input))
  await expect(service.prompt('chat', { ...input, content: [{ type: 'text', text: 'Different message' }] })).rejects.toMatchObject({ status: 409 })
  finish()
  expect(await first).toEqual({ accepted: true })
  expect(await retry).toEqual({ accepted: true })
  expect(calls).toBe(1)
})

test('two browser views can answer the same approval only once; stale answers are refused', async () => {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const notifications = createHarnessNotifications({
    get(name: string) { return (this as Record<string, unknown>)[name] },
    on: (name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler), effect() {},
    sessionController: { async *control(signal: AbortSignal) { await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })) } },
  } as never)
  const nativeResult = handlers.get('approval/request')!({ agent: { id: 'chat' }, toolName: 'test-command', callId: 'test-call', reason: 'Synthetic test' })
  const abort = new AbortController()
  const events = notifications.events('mux', abort.signal, () => {})[Symbol.asyncIterator]()
  const event = await events.next()
  const replies = await Promise.all([
    notifications.respond(event.value!.rpcId, { ok: true, value: { outcome: 'allowed-once' } }),
    notifications.respond(event.value!.rpcId, { ok: true, value: { outcome: 'denied' } }),
  ])
  expect(replies.map(item => item.accepted)).toEqual([true, false])
  expect(await nativeResult).toBe('allowed-once')
  abort.abort()
  await events.return?.()
})

test('JSON limits stop chunked requests before buffering an oversized body', async () => {
  let cancelled = false
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode('12345678')) }, cancel() { cancelled = true } })
  const request = new Request('http://localhost/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  await expect(parseJson(request, z.unknown(), 10)).rejects.toMatchObject({ status: 413 })
  expect(cancelled).toBeTrue()
})
