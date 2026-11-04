/**
 * Browser-safe entry point: transport and wire contract.
 *
 * Import `@hulala/host-client/node` for daemon discovery and detached startup.
 *
 * @module @hulala/host-client
 */
export {
  HostClient,
  HostClientError,
  assertHostProtocol,
  hostResponseError,
  type HostClientOptions,
  type HostRequestOptions,
} from './client.js'

export {
  API_PREFIX,
  CONNECTION_TOKEN_HEADER,
  HOST_DAEMON_PROTOCOL,
  connectionDescriptorSchema,
  healthSchema,
  runtimeStateSchema,
  type ConnectionDescriptor,
  type Health,
  type RuntimeState,
} from './protocol.js'
