import type { Context } from '@deepseek-ai/cordis'
import type { SessionControlFrame } from '@deepseek-ai/dsh-api-session-controller'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type { HarnessInteractionResult, HarnessNotifications, HarnessStreamEnvelope } from './runtime.ts'

type Channel = 'mux' | 'host'
type Pending = {
  payload: Record<string, unknown>
  finish(result: HarnessInteractionResult<unknown>): void
}

/** Translate current Harness domain events into the private conversation view. */
export function createHarnessNotifications(ctx: Context): HarnessNotifications {
  // This adapter is assembled inside the transport plugin. That plugin's
  // context cannot use undeclared property injection like a root context can.
  const sessionController = ctx.get('sessionController')
  const gateway = ctx.get('typertGateway')
  const listeners = { mux: new Set<(value: HarnessStreamEnvelope) => void>(), host: new Set<(value: HarnessStreamEnvelope) => void>() }
  const pending = new Map<string, Pending>()
  const emit = (kind: Channel, payload: Record<string, unknown>, rpcId = '') => {
    for (const listener of listeners[kind]) listener({ rpcId, payload })
  }
  ctx.on('session/event', (session, event) => emit('mux', { type: 'session/event', sessionId: session.id, event }))
  ctx.on('agent/assistant-stream', ({ agent, frame }) => emit('mux', {
    type: 'session/assistant-stream', sessionId: agent.id,
    frame: frame.type === 'start' ? { ...frame, startedAfterSeq: agent.session.seq - 1 } : frame,
  }))
  ctx.on('api-session/status', (sessionId, running) => emit('host', { type: 'host/session-status', sessionId, running }))
  ctx.on('api-session/added', summary => emit('host', { type: 'host/session-added', ...summary }))
  ctx.on('api-session/removed', sessionId => emit('host', { type: 'host/session-removed', sessionId }))
  ctx.on('api-session/error', (sessionId, message) => emit('host', { type: 'host/agent-error', sessionId, message }))
  ctx.on('api-session/activity', sessionId => emit('host', { type: 'host/session-activity', sessionId }))

  const ask = (kind: 'approval' | 'question', payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> => {
    if (signal?.aborted) return Promise.reject(signal.reason)
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const finish = (result: HarnessInteractionResult<unknown>) => {
        if (!pending.delete(id)) return
        signal?.removeEventListener('abort', abort)
        emit('mux', {
          type: `${kind}/resolved`, sessionId: payload.sessionId,
          approvalId: payload.approvalId, questionRpcId: id,
        })
        if (!result.ok) { reject(new Error(result.error.message)); return }
        const value = result.value as { outcome?: unknown; answer?: unknown }
        resolve(kind === 'approval' ? value.outcome : value.answer)
      }
      const abort = () => finish({ ok: false, error: { code: 'cancelled', message: 'Harness interaction cancelled' } })
      pending.set(id, { payload, finish })
      signal?.addEventListener('abort', abort, { once: true })
      emit('mux', payload, id)
    })
  }
  ctx.on('approval/request', async (request) => await ask('approval', {
    type: 'approval/requested', sessionId: request.agent.id,
    approvalId: crypto.randomUUID(), toolName: request.toolName,
    callId: request.callId, reason: request.reason,
  }, request.signal) as ApprovalOutcome)
  ctx.on('user-questions/request', async (request, next) => {
    if (!request.agent) return next()
    return await ask('question', {
      type: 'question/requested', sessionId: request.agent.id, questions: request.questions,
    }, request.signal) as AskUserQuestionAnswer
  })
  ctx.effect(() => () => {
    for (const item of [...pending.values()]) item.finish({ ok: false, error: { code: 'cancelled', message: 'Harness stopped' } })
  }, 'private Harness interaction teardown')

  return {
    async respond(id, result) {
      const item = pending.get(id)
      if (!item) return { accepted: false, reason: 'interaction is no longer pending' }
      item.finish(result)
      return { accepted: true }
    },
    async *events(kind, signal, onOpen) {
      const abort = new AbortController()
      const lifetime = AbortSignal.any([signal, abort.signal])
      const queue: HarnessStreamEnvelope[] = []
      let wake: (() => void) | undefined
      let failure: unknown
      const push = (value: HarnessStreamEnvelope) => { queue.push(value); wake?.() }
      listeners[kind].add(push)
      if (kind === 'mux') for (const [rpcId, item] of pending) push({ rpcId, payload: item.payload })
      const pump = async () => {
        let opened = false
        const ready = () => { if (!opened) { opened = true; onOpen() } }
        if (kind === 'mux') {
          if (!sessionController) throw new Error('Harness session controller is unavailable')
          for await (const frame of sessionController.control(lifetime)) {
            ready()
            for (const payload of controlPayloads(frame)) push({ rpcId: '', payload })
          }
        } else {
          if (!gateway) throw new Error('Harness event gateway is unavailable')
          const stream = await gateway.stream({ namespace: 'workspace', method: 'follow', args: {}, signal: lifetime })
          for await (const _frame of stream) { ready(); push({ rpcId: '', payload: { type: 'host/workspace-changed' } }) }
        }
      }
      const done = pump().then(
        () => { if (!lifetime.aborted) failure = new Error('Harness notification stream ended'); wake?.() },
        error => { if (!lifetime.aborted) failure = error; wake?.() },
      )
      const onAbort = () => wake?.()
      lifetime.addEventListener('abort', onAbort, { once: true })
      try {
        while (!lifetime.aborted) {
          if (failure) throw failure
          const value = queue.shift()
          if (value) { yield value; continue }
          await new Promise<void>(resolve => { wake = resolve })
          wake = undefined
        }
      } finally {
        listeners[kind].delete(push)
        abort.abort()
        lifetime.removeEventListener('abort', onAbort)
        await done
      }
    },
  }
}

function controlPayloads(frame: SessionControlFrame): Record<string, unknown>[] {
  if (frame.type !== 'baseline') return [{ ...frame, type: `session/${frame.type}` }]
  return [
    ...Object.entries(frame.value.queues).map(([sessionId, items]) => ({ type: 'session/queue', sessionId, items })),
    ...Object.entries(frame.value.jobs).map(([sessionId, jobs]) => ({ type: 'session/jobs', sessionId, jobs })),
    ...Object.entries(frame.value.projections).flatMap(([sessionId, block]) => Object.entries(block.values).map(([key, value]) => ({
      type: 'session/projection', sessionId, key, value, seq: block.asOfSeq,
    }))),
  ]
}
