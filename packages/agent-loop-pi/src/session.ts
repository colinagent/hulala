import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionLogOffset, SessionPreparation, interruptedTurnClosers, type Session } from '@deepseek-ai/dsh-session'
import type { SessionHandle, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

/** Own one Harness write handle for the complete native SDK agent lifetime. */
export async function withStoredAgentSession(
  ctx: Context,
  owner: Context,
  options: CreateAgentOptions | ResumeAgentOptions,
  publish: (session: Session, beforePublish: () => Promise<void>) => Promise<AgentHandle>,
): Promise<AgentHandle> {
  const persistence: SessionPersistence | undefined = ctx.get('sessionPersistence')
  let storage: SessionHandle | undefined
  let preparation: SessionPreparation | undefined
  let published: AgentHandle | undefined
  let storedCount = 0
  try {
    options.signal?.throwIfAborted()
    owner.fiber.assertActive()
    if ('resumeSessionId' in options) {
      if (!persistence) throw new Error('cannot resume: session persistence is not configured')
      storage = await persistence.open(options.resumeSessionId, 'write', { signal: options.signal })
      const restored = await storage.read(0, undefined, { signal: options.signal })
      const closers = interruptedTurnClosers(restored.events)
      if (closers.length) await storage.append(closers)
      storedCount = restored.events.length + closers.length
      preparation = SessionPreparation.create(ctx.sessions.prepare(storage.id, {
        seed: [...restored.events, ...closers],
        meta: structuredClone(storage.header),
        inheritedEventCount: storage.inheritedEventCount,
        eventState: restored.eventState,
      }))
    } else {
      preparation = SessionPreparation.create(ctx.sessions.prepare(options.sessionId, {
        seed: options.seed,
        meta: options.meta,
        inheritedEventCount: options.inheritedEventCount,
      }))
      storage = await persistence?.create(preparation.session.header, {
        inheritedEventCount: preparation.session.inheritedEventCount,
        signal: options.signal,
      })
    }
    const session = preparation.session
    const beforePublish = async () => {
      if (!storage) return
      const suffix = session.snapshotEvents(SessionLogOffset(storedCount))
      if (!suffix.length) return
      await storage.append(suffix)
      storedCount += suffix.length
    }
    options.signal?.throwIfAborted()
    owner.fiber.assertActive()
    published = await publish(session, beforePublish)
    const disposeAgent = published.dispose.bind(published)
    let disposing: Promise<void> | undefined
    published.dispose = () => disposing ??= (async () => {
      try {
        await disposeAgent()
      } finally {
        await storage?.close()
      }
    })()
    options.signal?.throwIfAborted()
    owner.fiber.assertActive()
    return published
  } catch (error) {
    try {
      await published?.dispose()
    } finally {
      await storage?.close()
    }
    throw error
  } finally {
    preparation?.[Symbol.dispose]()
  }
}
