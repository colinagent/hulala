import type {
  AuthorizationNotice,
  AuthorizationPrompt,
  AuthorizationService,
} from '@deepseek-ai/dsh-authorization'
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { OpenAICodexProviderAuthState } from '@hulala/workbench-contracts'

import { HttpError } from './http.ts'
import type { HarnessApiAdapter } from './runtime.ts'

const OPENAI_CODEX_CREDENTIAL_KEY = credentialKey('llm-pi-ai', 'openai-codex')

type AttemptView = NonNullable<OpenAICodexProviderAuthState['attempt']>
type PromptView = NonNullable<AttemptView['prompt']>

type PendingPrompt = {
  id: string
  resolve(value: string): void
  reject(error: Error): void
}

type InternalAttempt = AttemptView & {
  pending?: PendingPrompt
}

function promptView(prompt: AuthorizationPrompt): PromptView {
  const id = crypto.randomUUID()
  if (prompt.kind === 'select') {
    return {
      id,
      kind: 'select',
      message: prompt.message,
      options: prompt.options.map(option => ({ ...option })),
    }
  }
  return {
    id,
    kind: prompt.kind,
    message: prompt.message,
    ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
  }
}

function configurationError(error: unknown): string {
  return error instanceof Error ? error.message : 'OpenAI Codex provider activation failed'
}

/** Desktop-facing state machine for the single native Harness OpenAI Codex authorization flow. */
export class OpenAICodexAuthorizationController {
  private attempt: InternalAttempt | undefined

  constructor(
    private readonly harness: HarnessApiAdapter,
    private readonly authorization?: AuthorizationService,
    private readonly credentials?: CredentialProvider,
  ) {}

  async describe(): Promise<OpenAICodexProviderAuthState> {
    const flow = this.authorization?.describe(OPENAI_CODEX_CREDENTIAL_KEY)
    const credential = this.credentials === undefined
      ? { configured: false, writable: false as const }
      : await this.credentials.describeRecord(OPENAI_CODEX_CREDENTIAL_KEY)
    const provider = await this.harness.openAICodexProviderState()
    return {
      available: flow !== undefined,
      configured: credential.configured,
      writable: credential.writable,
      providerReady: credential.configured && provider.active && !provider.apiKeyOverride,
      apiKeyOverride: provider.apiKeyOverride,
      methods: flow?.methods.map(method => ({ ...method })) ?? [],
      ...(flow === undefined ? {} : {
        label: flow.label,
      }),
      ...(this.attempt === undefined ? {} : { attempt: this.attemptView(this.attempt) }),
    }
  }

  async start(): Promise<OpenAICodexProviderAuthState> {
    const authorization = this.requireAuthorization()
    const flow = authorization.describe(OPENAI_CODEX_CREDENTIAL_KEY)
    if (flow === undefined || !flow.methods.some(method => method.id === 'oauth')) {
      throw new HttpError(409, 'authorization_unavailable', 'OpenAI Codex account authorization is unavailable')
    }
    if (this.attempt?.status === 'running') {
      throw new HttpError(409, 'authorization_in_progress', 'OpenAI Codex account authorization is already running')
    }

    const attempt: InternalAttempt = {
      id: crypto.randomUUID(),
      status: 'running',
    }
    this.attempt = attempt
    void authorization.begin({
      key: OPENAI_CODEX_CREDENTIAL_KEY,
      method: 'oauth',
      interaction: {
        notify: notice => this.notify(attempt.id, notice),
        prompt: prompt => this.prompt(attempt.id, prompt),
      },
    }).then(
      outcome => this.finish(attempt.id, outcome.status),
      () => this.fail(attempt.id),
    )
    return this.describe()
  }

  async answer(attemptId: string, promptId: string, value: string): Promise<OpenAICodexProviderAuthState> {
    const attempt = this.requireRunningAttempt(attemptId)
    const pending = attempt.pending
    if (pending === undefined || pending.id !== promptId || attempt.prompt?.id !== promptId) {
      throw new HttpError(409, 'authorization_prompt_stale', 'The OpenAI Codex authorization prompt is no longer active')
    }
    if (attempt.prompt.kind === 'select' && !attempt.prompt.options.some(option => option.id === value)) {
      throw new HttpError(400, 'authorization_answer_invalid', 'The selected authorization option is invalid')
    }
    attempt.pending = undefined
    attempt.prompt = undefined
    pending.resolve(value)
    return this.describe()
  }

  async cancel(attemptId: string): Promise<OpenAICodexProviderAuthState> {
    this.requireRunningAttempt(attemptId)
    this.requireAuthorization().cancel(OPENAI_CODEX_CREDENTIAL_KEY)
    return this.describe()
  }

  async enable(): Promise<OpenAICodexProviderAuthState> {
    const credentials = this.requireCredentials()
    const credential = await credentials.describeRecord(OPENAI_CODEX_CREDENTIAL_KEY)
    if (!credential.configured) {
      throw new HttpError(409, 'authorization_required', 'Sign in to an OpenAI Codex account before enabling the provider')
    }
    await this.harness.enableOpenAICodexAccount()
    if (this.attempt?.status === 'authorized') this.attempt.configurationError = undefined
    return this.describe()
  }

  async signOut(): Promise<OpenAICodexProviderAuthState> {
    this.authorization?.cancel(OPENAI_CODEX_CREDENTIAL_KEY)
    this.rejectPending('OpenAI Codex account authorization was cancelled')
    await this.requireCredentials().deleteRecord(OPENAI_CODEX_CREDENTIAL_KEY)
    this.attempt = undefined
    return this.describe()
  }

  dispose(): void {
    this.authorization?.cancel(OPENAI_CODEX_CREDENTIAL_KEY)
    this.rejectPending('OpenAI Codex account authorization was cancelled')
    this.attempt = undefined
  }

  private notify(attemptId: string, notice: AuthorizationNotice): void {
    if (this.attempt?.id !== attemptId || this.attempt.status !== 'running') return
    this.attempt.notice = { ...notice }
  }

  private prompt(attemptId: string, prompt: AuthorizationPrompt): Promise<string> {
    const attempt = this.requireRunningAttempt(attemptId)
    if (attempt.pending !== undefined) {
      attempt.pending.reject(new Error('A newer OpenAI Codex authorization prompt replaced this prompt'))
    }
    const view = promptView(prompt)
    const result = Promise.withResolvers<string>()
    const pending: PendingPrompt = { id: view.id, resolve: result.resolve, reject: result.reject }
    attempt.prompt = view
    attempt.pending = pending
    const withdraw = () => {
      if (this.attempt?.id !== attemptId || this.attempt.pending !== pending) return
      this.attempt.pending = undefined
      this.attempt.prompt = undefined
      pending.reject(new Error('OpenAI Codex authorization prompt was withdrawn'))
    }
    prompt.signal?.addEventListener('abort', withdraw, { once: true })
    if (prompt.signal?.aborted) withdraw()
    return result.promise.finally(() => prompt.signal?.removeEventListener('abort', withdraw))
  }

  private async finish(attemptId: string, status: 'authorized' | 'cancelled'): Promise<void> {
    const attempt = this.attempt
    if (attempt?.id !== attemptId) return
    this.clearPending(attempt)
    if (status === 'cancelled') {
      attempt.status = 'cancelled'
      return
    }
    try {
      await this.harness.enableOpenAICodexAccount()
      if (this.attempt?.id === attemptId) this.attempt.status = 'authorized'
    } catch (error) {
      if (this.attempt?.id !== attemptId) return
      this.attempt.status = 'authorized'
      this.attempt.configurationError = configurationError(error)
    }
  }

  private fail(attemptId: string): void {
    const attempt = this.attempt
    if (attempt?.id !== attemptId) return
    this.clearPending(attempt)
    attempt.status = 'failed'
    attempt.error = 'OpenAI Codex account authorization failed. Try again or choose device code login.'
  }

  private clearPending(attempt: InternalAttempt): void {
    const pending = attempt.pending
    attempt.pending = undefined
    attempt.prompt = undefined
    pending?.reject(new Error('OpenAI Codex authorization attempt finished'))
  }

  private rejectPending(message: string): void {
    const attempt = this.attempt
    if (attempt === undefined) return
    const pending = attempt.pending
    attempt.pending = undefined
    attempt.prompt = undefined
    pending?.reject(new Error(message))
  }

  private requireRunningAttempt(attemptId: string): InternalAttempt {
    const attempt = this.attempt
    if (attempt?.id !== attemptId || attempt.status !== 'running') {
      throw new HttpError(409, 'authorization_attempt_stale', 'The OpenAI Codex authorization attempt is no longer active')
    }
    return attempt
  }

  private requireAuthorization(): AuthorizationService {
    if (this.authorization === undefined) {
      throw new HttpError(409, 'authorization_unavailable', 'Harness authorization is unavailable')
    }
    return this.authorization
  }

  private requireCredentials(): CredentialProvider {
    if (this.credentials === undefined) {
      throw new HttpError(409, 'credential_store_unavailable', 'Harness credential storage is unavailable')
    }
    return this.credentials
  }

  private attemptView(attempt: InternalAttempt): AttemptView {
    return {
      id: attempt.id,
      status: attempt.status,
      ...(attempt.notice === undefined ? {} : { notice: { ...attempt.notice } }),
      ...(attempt.prompt === undefined ? {} : { prompt: structuredClone(attempt.prompt) }),
      ...(attempt.error === undefined ? {} : { error: attempt.error }),
      ...(attempt.configurationError === undefined ? {} : { configurationError: attempt.configurationError }),
    }
  }
}
