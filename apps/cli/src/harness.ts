import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { VERSION, APP_PORT, WORKBENCH_PORT } from './constants.js'
declare const __HULALA_COMPILED__: boolean | undefined

export async function spawnWorkbench(): Promise<{ child: ChildProcess; temporaryDirectory: string }> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'hulala-harness-'))
  const packageRoot = process.env.HULALA_PACKAGE_ROOT
  if (typeof __HULALA_COMPILED__ !== 'undefined' && __HULALA_COMPILED__ && !packageRoot) throw new Error('The native CLI requires a verified package directory')
  const repositoryRoot = typeof __HULALA_COMPILED__ !== 'undefined' && __HULALA_COMPILED__ ? join(packageRoot!, 'runtime') : process.env.HULALA_REPOSITORY_ROOT || fileURLToPath(new URL('../../../', import.meta.url))
  const executable = packageRoot ? join(packageRoot, 'runtime/bin', process.platform === 'win32' ? 'bun.exe' : 'bun') : process.execPath
  const child = spawn(executable, [packageRoot ? join(packageRoot, 'runtime/host/browser.js') : join(repositoryRoot, 'apps/local-host/src/browser-main.ts')], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
    env: { ...process.env, HULALA_VERSION: VERSION, HULALA_REPOSITORY_ROOT: repositoryRoot, HULALA_PORT: String(APP_PORT), HULALA_WORKBENCH_PORT: String(WORKBENCH_PORT) },
  })

  return { child, temporaryDirectory }
}
