import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { APP_AUTHORITY, APP_HOST, VERSION, WORKBENCH_PORT } from './constants.js'

export async function spawnWorkbench(): Promise<{ child: ChildProcess; temporaryDirectory: string }> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'hulala-harness-'))
  const require = createRequire(import.meta.url)
  const repositoryRoot = process.env.HULALA_REPOSITORY_ROOT || fileURLToPath(new URL('../../../', import.meta.url))
  const packageRoot = process.env.HULALA_PACKAGE_ROOT
  const executable = packageRoot ? join(packageRoot, 'runtime/bin', process.platform === 'win32' ? 'bun.exe' : 'bun') : process.versions.bun ? process.execPath : require.resolve('bun/bin/bun.exe')
  const child = spawn(executable, [packageRoot ? join(packageRoot, 'runtime/host/browser.js') : join(repositoryRoot, 'apps/local-host/src/browser-main.ts')], {
    stdio: 'inherit',
    env: { ...process.env, HULALA_VERSION: VERSION, HULALA_REPOSITORY_ROOT: repositoryRoot, HULALA_WORKBENCH_PORT: String(WORKBENCH_PORT) },
  })

  return { child, temporaryDirectory }
}
