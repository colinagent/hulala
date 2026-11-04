/**
 * Browser-safe client for one running Hulala Host.
 *
 * The client is a thin, typed transport: it adds the process-scoped token to
 * every request and validates responses against the shared contract. Process
 * discovery and detached startup live in `@hulala/host-client/node`, so this
 * module never touches the filesystem and can ship to a renderer or a browser.
 *
 * @module @hulala/host-client
 */
import type { ZodType } from 'zod'
import {
  API_PREFIX,
  CONNECTION_TOKEN_HEADER,
  HOST_DAEMON_PROTOCOL,
  healthSchema,
  type ConnectionDescriptor,
  type Health,
} from './protocol.js'

/** One Host request failure carrying the server's machine-readable code. */
export class HostClientError extends Error {
  constructor(
    /** HTTP status, or 0 when the Host could not be reached at all. */
    readonly status: number,
    /** Stable error code from the Host, or a client-side code. */
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'HostClientError'
  }
}

export interface HostClientOptions {
  /** Loopback base URL, for example `http://127.0.0.1:4399`. */
  baseUrl: string
  /** Process-scoped token published by the Host descriptor. */
  token: string
  /** Injectable transport; tests and Electron may supply their own fetch. */
  fetch?: typeof fetch
}

export interface HostRequestOptions extends RequestInit {
  /** Body serialized as JSON with the matching content type. */
  json?: unknown
}

/**
 * Attach to a Host over its published loopback transport.
 */
export class HostClient {
  readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(options: HostClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    this.fetchImpl = options.fetch ?? fetch
  }

  /** Build a client from the descriptor a Host or launcher published. */
  static fromDescriptor(descriptor: ConnectionDescriptor, options: Omit<HostClientOptions, 'baseUrl' | 'token'> = {}): HostClient {
    return new HostClient({ ...options, baseUrl: descriptor.httpUrl, token: descriptor.token })
  }

  /** Resolve one `/api/desktop/v1` route against the Host. */
  url(path: string): string {
    return `${this.baseUrl}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`
  }

  /** Send a request with the Host token attached. */
  async request(path: string, options: HostRequestOptions = {}): Promise<Response> {
    const { json, ...init } = options
    const headers = new Headers(init.headers)
    headers.set(CONNECTION_TOKEN_HEADER, this.token)
    if (json !== undefined) {
      headers.set('content-type', 'application/json')
      init.body = JSON.stringify(json)
    }
    init.headers = headers
    try {
      return await this.fetchImpl(this.url(path), init)
    } catch (error) {
      throw new HostClientError(0, 'host_unreachable', `Hulala Host is not reachable at ${this.baseUrl}`, error)
    }
  }

  /** Send a request and validate the JSON body against a shared contract. */
  async json<T>(path: string, schema: ZodType<T>, options: HostRequestOptions = {}): Promise<T> {
    const response = await this.request(path, options)
    if (!response.ok) throw await hostResponseError(response)
    return schema.parse(await response.json())
  }

  /** Send a request that answers without a body. */
  async send(path: string, options: HostRequestOptions = {}): Promise<void> {
    const response = await this.request(path, options)
    if (!response.ok) throw await hostResponseError(response)
    await response.arrayBuffer()
  }

  /** Read the Host health document; this is also the protocol handshake. */
  async health(): Promise<Health> {
    return this.json('/health', healthSchema)
  }
}

/** Read a failed Host response into a client error without masking a bad body. */
export async function hostResponseError(response: Response): Promise<HostClientError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  const code = typeof record.code === 'string' && record.code ? record.code : `http_${response.status}`
  const message = typeof record.message === 'string' && record.message ? record.message : `Hulala Host answered ${response.status}`
  return new HostClientError(response.status, code, message, record.details)
}

/**
 * Reject a Host that speaks a discovery protocol this build cannot drive.
 * @param health - health document returned by the Host.
 * @param expected - protocol this client was built against.
 */
export function assertHostProtocol(health: Health, expected: number = HOST_DAEMON_PROTOCOL): void {
  if (health.protocol === expected) return
  throw new HostClientError(
    426,
    'host_protocol_incompatible',
    `Hulala Host speaks protocol ${health.protocol}, but this client requires ${expected}. Stop the running Host and start it again.`,
    { host: health.protocol, client: expected },
  )
}
