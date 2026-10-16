import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONNECTION_TOKEN_HEADER } from '@hulala/workbench-contracts'
import { createDesktopServer, type DesktopServerHandle } from '../src/server.ts'
import { fakeHarnessClient, fakeNativeServices } from './harness-fixture.ts'

const handles: DesktopServerHandle[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map(handle => handle.stop()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

test('keeps Harness interaction rpcId in the private Server and returns a typed answer', async () => {
  const sessionId = 'session-interaction-1234'
  const harnessWorkspaceId = 'harness-workspace-1'
  let responseEnvelope: unknown
  let selectedPresetPayload: unknown
  const fixture = fakeHarnessClient({
    unary(method, payload) {
      if (method === 'agentPresets/select') selectedPresetPayload = payload
      const workspace = {
        workspaceId: harnessWorkspaceId,
        path: roots.at(-1),
        title: 'workspace',
        sessionIds: [sessionId],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      const value = method === 'workspace/create'
        ? { workspace, created: false }
        : method === 'workspace/follow'
          ? { items: [workspace], archivedSessionIds: [] }
          : method === 'session/list'
            ? { items: [{ sessionId, cwd: workspace.path, blank: true, running: true, updatedAt: Date.now() }] }
            : method === 'session/follow'
              ? { events: [], hasMore: false, projections: { asOfSeq: -1, values: {} } }
              : method === 'agentPresets/select'
                ? { agentPreset: payload.agentPreset }
                : {}
      return value
    },
    muxFrames: [{
      rpcId: 'approval-rpc-1',
      payload: {
        type: 'approval/requested',
        sessionId,
        approvalId: 'approval-1',
        toolName: 'bash',
        callId: 'call-1',
        reason: 'Run a workspace command',
      },
    }],
    respond(message) {
      responseEnvelope = message
      return { accepted: true }
    },
  })
  const root = await mkdtemp(join(tmpdir(), 'hulala-conversation-bridge-'))
  roots.push(root)
  const handle = await createDesktopServer({
    host: '127.0.0.1',
    port: 0,
    hulalaRoot: root,
    workspaceRoot: join(root, 'managed-workspaces'),
    version: 'test',
  }, { ...fakeNativeServices(), ...fixture.services })
  handles.push(handle)
  await Bun.sleep(80)
  const headers = { [CONNECTION_TOKEN_HEADER]: handle.descriptor.token }
  const workspaces = await (await fetch(`${handle.descriptor.httpUrl}/api/desktop/v1/workspaces`, { headers })).json() as { items: Array<{ id: string }> }
  const opened = await (await fetch(`${handle.descriptor.httpUrl}/api/desktop/v1/conversations/open`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'workspace', workspaceId: workspaces.items[0].id }),
  })).json() as { snapshot: { pendingInteractions: Array<{ interactionId: string; kind: string }> } }
  expect(opened.snapshot.pendingInteractions).toHaveLength(1)
  expect(opened.snapshot.pendingInteractions[0]).toMatchObject({ kind: 'approval' })
  expect(JSON.stringify(opened)).not.toContain('approval-rpc-1')

  const answer = await fetch(`${handle.descriptor.httpUrl}/api/desktop/v1/conversations/interactions/${opened.snapshot.pendingInteractions[0].interactionId}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'approval', outcome: 'allowed-once' }),
  })
  expect(answer.status).toBe(200)
  expect(responseEnvelope).toEqual({
    rpcId: 'approval-rpc-1',
    result: {
      ok: true,
      value: { sessionId, approvalId: 'approval-1', outcome: 'allowed-once' },
    },
  })

  const selection = await fetch(`${handle.descriptor.httpUrl}/api/desktop/v1/conversations/${sessionId}/agent-preset`, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ agentPreset: 'careful-agent' }),
  })
  expect(selection.status).toBe(200)
  expect(await selection.json()).toEqual({ agentPreset: 'careful-agent' })
  expect(selectedPresetPayload).toEqual({ agentId: sessionId, agentPreset: 'careful-agent' })
})
