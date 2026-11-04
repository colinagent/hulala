/**
 * Node-only entry point: discovery, detached startup and shutdown.
 *
 * Browsers and renderers import `@hulala/host-client` instead; that entry point
 * carries no filesystem or process access.
 *
 * @module @hulala/host-client/node
 */
export {
  HostDaemonError,
  ensureHostDaemon,
  stopHostDaemon,
  type EnsureHostDaemonOptions,
  type HostDaemonConnection,
  type HostDaemonErrorCode,
  type HostDaemonLauncher,
  type HostDaemonLaunchSpec,
} from './ensureHostDaemon.js'

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

export {
  discoverHostDaemon,
  hostEndpointRecordSchema,
  probeHostEndpoint,
  readHostEndpoint,
  resolveHostDaemonPaths,
  type HostDaemonDiscovery,
  type HostDaemonPaths,
  type HostDaemonRoots,
  type HostEndpointRecord,
  type HostProbeOptions,
} from './discovery.js'
