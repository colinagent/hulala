import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ReactLoopInbox } from '../src/inbox.ts'
import { withStoredAgentSession } from '../src/session.ts'

async function fixture(run: (ctx: Context, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'hulala-sdk-session-'))
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjections)
    await ctx.plugin(JsonlPersistence, { root, compression: 'none' })
    await run(ctx, root)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

function publish(ctx: Context) {
  return async (session: Session, beforePublish: () => Promise<void>) => {
    await beforePublish()
    const detach = ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    return { agent: { id: session.id, session } as never, dispose: async () => { detach() } }
  }
}

test('persists SDK session setup and live events once and restores pending inbox after reopening', async () => {
  await fixture(async (ctx, root) => {
    const id = SessionId('sdk-persistence-test')
    const prompt = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'queued work' }] })
    const dispatch = { emit: () => {} } as never
    const handle = await withStoredAgentSession(ctx, ctx, { sessionId: id, meta: { cwd: root } }, async (session, beforePublish) => {
      new ReactLoopInbox(ctx.sessionProjections, session, dispatch).append('next-turn', prompt)
      return publish(ctx)(session, beforePublish)
    })
    const session = ctx.sessions.get(id)!
    session.append('turn/start', { turn: 1 })
    await ctx.sessionPersistence.flush()
    await assert.rejects(ctx.sessionPersistence.open(id, 'write'), /owned|ownership|already/i)
    await handle.dispose()
    const cold = await ctx.sessionPersistence.open(id, 'read')
    assert.deepEqual((await cold.read()).events.map(event => event.type), ['agent/inbox/spliced', 'turn/start'])
    await cold.close()

    const resumed = await withStoredAgentSession(ctx, ctx, { resumeSessionId: id }, publish(ctx))
    const restored = ctx.sessions.get(id)!
    const inbox = new ReactLoopInbox(ctx.sessionProjections, restored, dispatch)
    assert.equal(inbox.nextTurn[0]?.id, prompt.id)
    assert.equal(restored.snapshotEvents().filter(event => event.type === 'turn/end').length, 1)
    assert.deepEqual(inbox.claim('next-turn', 2).map(message => message.id), [prompt.id])
    assert.equal(inbox.hasPending, false)
    await resumed.dispose()
    const reopened = await ctx.sessionPersistence.open(id, 'read')
    const events = (await reopened.read()).events
    assert.deepEqual(events.map(event => event.seq), events.map((_, index) => index))
    assert.equal(events.filter(event => event.type === 'agent/inbox/spliced').length, 2)
    await reopened.close()
  })
})

test('failed SDK setup releases its unpublished session write ownership', async () => {
  await fixture(async (ctx) => {
    const id = SessionId('sdk-setup-failure')
    await assert.rejects(withStoredAgentSession(ctx, ctx, { sessionId: id }, async () => {
      throw new Error('setup failed')
    }), /setup failed/)
    assert.equal(await ctx.sessionPersistence.stat(id), undefined)
    const retry = await withStoredAgentSession(ctx, ctx, { sessionId: id }, publish(ctx))
    await retry.dispose()
  })
})
