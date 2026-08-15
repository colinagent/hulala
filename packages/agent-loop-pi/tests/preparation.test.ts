import assert from 'node:assert/strict'
import test from 'node:test'
import type { Session, SessionPreparation } from '@deepseek-ai/dsh-session'

import { withSessionPreparation } from '../src/index.ts'

function fakePreparation(onDispose: () => void): SessionPreparation {
  return {
    session: { id: 'session-test' } as Session,
    [Symbol.dispose]: onDispose,
  } as SessionPreparation
}

test('holds a persisted Session preparation until asynchronous publication settles', async () => {
  const gate = Promise.withResolvers<void>()
  let disposed = false
  const pending = withSessionPreparation(fakePreparation(() => { disposed = true }), async session => {
    assert.equal(session.id, 'session-test')
    assert.equal(disposed, false)
    await gate.promise
    assert.equal(disposed, false)
    return 'published'
  })

  await Promise.resolve()
  assert.equal(disposed, false)
  gate.resolve()
  assert.equal(await pending, 'published')
  assert.equal(disposed, true)
})

test('releases a Session preparation after asynchronous publication rejects', async () => {
  let disposed = false
  await assert.rejects(withSessionPreparation(fakePreparation(() => { disposed = true }), async () => {
    await Promise.resolve()
    throw new Error('publish failed')
  }), /publish failed/)
  assert.equal(disposed, true)
})
