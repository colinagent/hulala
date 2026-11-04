/**
 * Local Host discovery contract.
 *
 * The Host is one long-lived server per Hulala state root. It publishes an
 * `endpoint.json` beside a single-instance lock so that Desktop, the CLI and
 * the terminal client can attach to the same process instead of each spawning
 * a private copy.
 *
 * The implementation lives in the public `@hulala/host-client` package, which
 * every client shares; this subpath keeps the product's imports stable.
 *
 * @module @hulala/desktop-contracts/hostdaemon
 */
export * from '@hulala/host-client/node'
