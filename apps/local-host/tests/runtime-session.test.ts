import { expect, test } from 'bun:test'
import { HarnessApiAdapter } from '../src/runtime.ts'
import { fakeHarnessClient } from './harness-fixture.ts'

function clientFor(values: (method: string, payload: Record<string, unknown>) => unknown) {
  const fixture = fakeHarnessClient({ unary: values })
  return { client: new HarnessApiAdapter({ ...fixture.services }), calls: fixture.calls }
}

test('creates a new native Session when the only blank workspace Session is archived', async () => {
  const archived = 'session-archived-1234'
  const created = 'session-created-5678'
  const { client, calls } = clientFor((method) => method === 'workspace/create'
    ? { workspace: { workspaceId: 'workspace-1', path: '/workspace', sessionIds: [archived] } }
    : method === 'workspace/follow'
      ? { items: [{ workspaceId: 'workspace-1', path: '/workspace', sessionIds: [archived] }], archivedSessionIds: [archived] }
      : method === 'session/list'
        ? { items: [{ sessionId: archived, cwd: '/workspace', blank: true }] }
        : { sessionId: created })

  await expect(client.openWorkspaceSession('/workspace')).resolves.toEqual({ sessionId: created, workspaceId: 'workspace-1' })
  expect(calls).toEqual(['workspace/create', 'workspace/follow', 'session/list', 'session/create'])
})

test('validates a requested native Session before launching it', async () => {
  const { client } = clientFor((method) => method === 'session/list' ? { items: [] } : {})
  await expect(client.requireSession('session-missing-1234')).rejects.toThrow('Harness session not found')
})

test('resolves the backend-owned artifact path for live and cold Sessions', async () => {
  const liveId = 'session-live-1234'
  const coldId = 'session-cold-5678'
  const liveHeader = { id: liveId }
  const coldHeader = { id: coldId }
  const client = new HarnessApiAdapter({
    sessions: {
      get: (id: string) => id === liveId ? { header: liveHeader } : undefined,
    } as never,
    sessionPersistence: {
      stat: async (id: string) => id === coldId ? { header: coldHeader } : undefined,
      flush: async () => {},
      resolveCurrentLog: async (id: string) => `/harness/sessions/${id}/session.v3.jsonl.zstd`,
    } as never,
  })

  await expect(client.sessionLocation(liveId)).resolves.toEqual({
    sessionId: liveId,
    kind: 'jsonl',
    path: `/harness/sessions/${liveId}/session.v3.jsonl.zstd`,
  })
  await expect(client.sessionLocation(coldId)).resolves.toEqual({
    sessionId: coldId,
    kind: 'jsonl',
    path: `/harness/sessions/${coldId}/session.v3.jsonl.zstd`,
  })
})
