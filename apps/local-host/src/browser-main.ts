import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { resolveHulalaPaths } from '@hulala/workbench-contracts/paths'
import { startBrowserServer } from './browser/server'

async function main(): Promise<void> {
  const packageRoot = process.env.HULALA_PACKAGE_ROOT
  const repositoryRoot = packageRoot ? join(packageRoot, 'runtime') : resolve(process.env.HULALA_REPOSITORY_ROOT || fileURLToPath(new URL('../../../', import.meta.url)))
  const paths = resolveHulalaPaths()
  const port = Number(process.env.HULALA_WORKBENCH_PORT || 3211)
  const publicPort = Number(process.env.HULALA_PORT || 80)
  const handle = await startBrowserServer({ repositoryRoot, hulalaRoot: paths.root, workspaceRoot: paths.workspaceRoot, port, publicPort, version: process.env.HULALA_VERSION || '0.1.6',
    webDirectory: packageRoot ? join(packageRoot, 'web') : join(repositoryRoot, 'apps/workbench/dist'),
    settingsDirectory: packageRoot ? join(packageRoot, 'settings') : join(repositoryRoot, 'apps/workbench/settings'),
    ...(packageRoot ? { entrypoint: join(repositoryRoot, 'host/worker.js'), runtimeHostModule: join(repositoryRoot, 'runtime/host.js') } : {}),
  })
  let stopping = false
  const stop = async () => { if (stopping) return; stopping = true; await handle.stop(); process.exit(0) }
  process.once('SIGINT', () => void stop())
  process.once('SIGTERM', () => void stop())
  if (typeof process.send === 'function') {
    process.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'hulala.stop') void stop() })
    process.once('disconnect', () => void stop())
    if (!process.connected) void stop()
  }
}
void main().catch(error => { console.error(error); process.exit(1) })
