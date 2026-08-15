import { fileURLToPath } from 'node:url'

import { startDetached } from './daemon.js'
import { portIsOccupied, probeHealth, waitForHealth } from './health.js'
import { readActiveManifest, rollbackManagedVersion } from './managed-runtime.js'
import { resolvePaths } from './paths.js'

export async function runWatchdog(entryPath = fileURLToPath(import.meta.url)): Promise<number> {
  let closing = false
  process.once('SIGINT', () => { closing = true })
  process.once('SIGTERM', () => { closing = true })
  const paths = resolvePaths()
  while (!closing) {
    const health = await probeHealth()
    if (health === undefined && !await portIsOccupied()) {
      await startDetached(entryPath, paths)
      const ready = await waitForHealth(45_000)
      if (ready === undefined && process.env.LOOPWITHAI_MANAGED_VERSION !== undefined) {
        const active = await readActiveManifest(paths)
        if (active?.version === process.env.LOOPWITHAI_MANAGED_VERSION && active.previous !== undefined) {
          await rollbackManagedVersion(paths)
          return 1
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
  return 0
}
