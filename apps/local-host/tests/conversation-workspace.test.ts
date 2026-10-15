import { expect, test } from 'bun:test'
import { ConversationService } from '../src/conversation.ts'
import { EventHub } from '../src/events.ts'
import { HarnessApiAdapter } from '../src/runtime.ts'
import { fakeHarnessClient } from './harness-fixture.ts'

const sessionA = 'session-workspace-a'
const sessionB = 'session-workspace-b'
const workspaces = [
  {
    workspaceId: 'workspace-a',
    path: '/workspace/a',
    title: 'A',
    sessionIds: [sessionA],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    workspaceId: 'workspace-b',
    path: '/workspace/b',
    title: 'B',
    sessionIds: [sessionB],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

function service() {
  const fixture = fakeHarnessClient({
    unary(method) {
      if (method === 'workspace/follow') return { items: workspaces, archivedSessionIds: [] }
      if (method === 'session/list') return {
        items: [
          { sessionId: sessionA, cwd: '/workspace/a', blank: false, running: false, updatedAt: 2 },
          { sessionId: sessionB, cwd: '/workspace/b', blank: false, running: false, updatedAt: 1 },
        ],
      }
      if (method === 'session/follow') return {
        events: [],
        hasMore: false,
        projections: { asOfSeq: -1, values: {} },
      }
      return {}
    },
  })
  return new ConversationService(new HarnessApiAdapter({ ...fixture.services }), new EventHub())
}

test('opening a Session returns only the active Workspace history', async () => {
  const opened = await service().open(
    { kind: 'session', workspaceId: 'workspace-a', sessionId: sessionA },
    '/workspace/a',
  )
  expect(opened.workspaceId).toBe('workspace-a')
  expect(opened.sessions.map(session => session.sessionId)).toEqual([sessionA])
})

test('rejects opening a Session through a different Workspace', async () => {
  await expect(service().open(
    { kind: 'session', workspaceId: 'workspace-a', sessionId: sessionB },
    '/workspace/a',
  )).rejects.toMatchObject({
    status: 409,
    code: 'session_workspace_mismatch',
  })
})
