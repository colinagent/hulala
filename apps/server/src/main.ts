#!/usr/bin/env bun
import { parseServerConfig } from './config.ts'
import { createDesktopHost } from './host.ts'
import { prepareHostDaemon } from './daemon.ts'

async function main(): Promise<void> {
  const config = parseServerConfig()

  // Claim the daemon role before booting anything, so a second start never loads
  // plugins, cron or the product database next to a live daemon.
  const prepared = config.daemon ? await prepareHostDaemon(config) : undefined
  if (prepared?.kind === 'already-running') {
    console.log(JSON.stringify({ type: 'hulala-daemon-running', ...prepared.record.descriptor }))
    return
  }
  if (prepared?.kind === 'conflict') throw new Error(prepared.reason)
  const lifecycle = prepared?.kind === 'ready' ? prepared.lifecycle : undefined

  const handle = await createDesktopHost(config).catch(async (error: unknown) => {
    await lifecycle?.dispose()
    throw error
  })
  // Publish only after the authenticated transport exists: a client that reads
  // the endpoint must be able to connect immediately.
  await lifecycle?.publish({
    descriptor: handle.descriptor,
    version: config.version,
    hulalaRoot: handle.paths.root,
    workspaceRoot: handle.paths.workspaceRoot,
  })
  console.log(JSON.stringify({ type: 'hulala-server-ready', ...handle.descriptor }))

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await lifecycle?.dispose()
    await handle.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => void stop())
  process.once('SIGTERM', () => void stop())
  // A daemon outlives the shell that spawned it; only an explicit stop retires it.
  if (config.daemon) process.on('SIGHUP', () => undefined)
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
