/**
 * Wire contract shared by every Hulala Host and its clients.
 *
 * Browser-safe: no filesystem or process access, so a renderer or web client can
 * validate the same documents the Host produces.
 *
 * @module @hulala/host-client
 */
import { z } from 'zod'

/** Route prefix every Host API lives under. */
export const API_PREFIX = '/api/desktop/v1'

/** Header carrying the process-scoped connection token. */
export const CONNECTION_TOKEN_HEADER = 'x-hulala-token'

/**
 * Version of the local Host discovery contract. A client may only drive a Host
 * that reports this exact value; `endpoint.json` is a local file, so a stale or
 * foreign value must never be trusted silently.
 */
export const HOST_DAEMON_PROTOCOL = 2

/** Authenticated loopback transport published by a Host. */
export const connectionDescriptorSchema = z.object({
  httpUrl: z.string().url(),
  eventsUrl: z.string().url(),
  token: z.string().min(32),
  instanceId: z.string().min(1),
  authCookieName: z.string().regex(/^hulala_[A-Za-z0-9_]+$/),
})

export type ConnectionDescriptor = z.infer<typeof connectionDescriptorSchema>

/** Lifecycle of the Agent runtime inside the Host. */
export const runtimeStateSchema = z.object({
  state: z.enum(['disabled', 'starting', 'running', 'stopping', 'stopped', 'failed']),
  url: z.string().url().optional(),
  error: z.string().optional(),
})

export type RuntimeState = z.infer<typeof runtimeStateSchema>

/** Health document served at `/health`; also the protocol handshake. */
export const healthSchema = z.object({
  name: z.literal('hulala-desktop-server'),
  /** Discovery protocol the running Host speaks. */
  protocol: z.number().int().positive(),
  version: z.string(),
  instanceId: z.string().min(1),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  runtime: runtimeStateSchema,
})

export type Health = z.infer<typeof healthSchema>
