import { expect, test } from 'bun:test'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import {
  CredentialProvider,
  credentialKey,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { Context } from '@deepseek-ai/cordis'

import { OpenAICodexAuthorizationController } from '../src/providerAuthorization.ts'
import { HarnessApiAdapter } from '../src/runtime.ts'
import { fakeHarnessClient } from './harness-fixture.ts'

const key = credentialKey('llm-pi-ai', 'openai-codex')

class MemoryCredentials extends CredentialProvider {
  private readonly records = new Map<CredentialKey, CredentialRecord>()

  resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> { return Promise.resolve(undefined) }
  describe(_ref: CredentialRef): Promise<CredentialInfo> { return Promise.resolve({ configured: false, writable: true }) }
  set(_ref: CredentialRef, _value: string): Promise<void> { return Promise.resolve() }
  unset(_ref: CredentialRef): Promise<void> { return Promise.resolve() }
  readRecord(recordKey: CredentialKey): Promise<CredentialRecord | undefined> { return Promise.resolve(this.records.get(recordKey)) }
  describeRecord(recordKey: CredentialKey): Promise<CredentialRecordInfo> {
    const record = this.records.get(recordKey)
    return Promise.resolve({ configured: record !== undefined, kind: record?.kind, writable: true })
  }
  listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([...this.records].map(([recordKey, record]) => ({ key: recordKey, kind: record.kind })))
  }
  async modifyRecord(
    recordKey: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const next = await mutate(this.records.get(recordKey))
    if (next !== undefined) this.records.set(recordKey, next)
    this.notifyRecordUpdated(recordKey)
    return next
  }
  deleteRecord(recordKey: CredentialKey): Promise<void> {
    this.records.delete(recordKey)
    this.notifyRecordUpdated(recordKey)
    return Promise.resolve()
  }
}

async function waitFor(
  controller: OpenAICodexAuthorizationController,
  predicate: (state: Awaited<ReturnType<typeof controller.describe>>) => boolean,
) {
  for (let index = 0; index < 50; index += 1) {
    const state = await controller.describe()
    if (predicate(state)) return state
    await Bun.sleep(5)
  }
  throw new Error('authorization state did not settle')
}

async function fixture(options: { hanging?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  ctx.authorization.registerFlow({
    key,
    label: 'OpenAI Codex',
    methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
    async run(session) {
      const method = await session.prompt({
        kind: 'select',
        message: 'Select login method',
        options: [
          { id: 'browser', label: 'Browser login' },
          { id: 'device_code', label: 'Device code login' },
        ],
      })
      if (options.hanging) {
        await new Promise<void>((_resolve, reject) => {
          session.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        })
      }
      session.notify(method === 'device_code'
        ? { message: 'Enter the code', url: 'https://auth.openai.com/codex/device', code: 'ABCD-1234' }
        : { message: 'Open the browser', url: 'https://auth.openai.com/oauth/authorize' })
      await ctx.credentials.modifyRecord(key, () => Promise.resolve({
        kind: 'grant',
        payload: { access: 'secret-access-token', refresh: 'secret-refresh-token' },
      }))
    },
  })

  let profile: Record<string, unknown> | undefined = { apiKeyEnv: 'OPENAI_CODEX_API_KEY' }
  let revision = 1
  const client = fakeHarnessClient({
    unary(method, payload) {
      if (method === 'settings/describe') {
        return {
          namespaces: [{
            ns: 'llm-pi-ai',
            value: { providers: profile === undefined ? {} : { 'openai-codex': profile } },
            user: { providers: profile === undefined ? {} : { 'openai-codex': profile } },
            revision,
          }],
        }
      }
      if (method === 'settings/mutate') {
        for (const op of payload.ops as Array<{ op: string; path: string[]; value?: unknown }>) {
          if (op.path.join('.') === 'providers.openai-codex' && op.op === 'set') profile = op.value as Record<string, unknown>
          if (op.path.join('.') === 'providers.openai-codex.apiKeyEnv' && op.op === 'unset' && profile !== undefined) {
            const next = { ...profile }
            delete next.apiKeyEnv
            profile = next
          }
        }
        revision += 1
        return { revision }
      }
      if (method === 'llm/listConfigurableProviders') {
        return { providers: [{ provider: 'openai-codex', active: profile !== undefined }] }
      }
      return {}
    },
  })
  const harness = new HarnessApiAdapter({ ...client.services })
  const controller = new OpenAICodexAuthorizationController(harness, ctx.authorization, ctx.credentials)
  return { ctx, controller, profile: () => profile }
}

test('authorizes OpenAI Codex, removes the API-key override, and never returns the grant payload', async () => {
  const { ctx, controller, profile } = await fixture()
  const started = await controller.start()
  expect(started.attempt?.prompt).toMatchObject({ kind: 'select' })
  const prompt = started.attempt?.prompt
  if (prompt === undefined) throw new Error('missing login prompt')
  await controller.answer(started.attempt!.id, prompt.id, 'device_code')

  const authorized = await waitFor(controller, state => state.attempt?.status === 'authorized')
  expect(authorized).toMatchObject({ configured: true, providerReady: true, apiKeyOverride: false })
  expect(profile()).toEqual({})
  expect(JSON.stringify(authorized)).not.toContain('secret-access-token')
  expect(JSON.stringify(authorized)).not.toContain('secret-refresh-token')

  const signedOut = await controller.signOut()
  expect(signedOut.configured).toBeFalse()
  expect(await ctx.credentials.readRecord(key)).toBeUndefined()
  await ctx.fiber.dispose()
})

test('cancels a running OpenAI Codex authorization attempt', async () => {
  const { ctx, controller } = await fixture({ hanging: true })
  const started = await controller.start()
  const prompt = started.attempt?.prompt
  if (prompt === undefined || started.attempt === undefined) throw new Error('missing login prompt')
  await controller.answer(started.attempt.id, prompt.id, 'browser')
  await controller.cancel(started.attempt.id)

  const cancelled = await waitFor(controller, state => state.attempt?.status === 'cancelled')
  expect(cancelled.configured).toBeFalse()
  await ctx.fiber.dispose()
})
