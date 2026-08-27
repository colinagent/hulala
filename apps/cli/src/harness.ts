import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { APP_AUTHORITY, APP_HOST, VERSION, WORKBENCH_PORT } from './constants.js'
import { createPackagedHarnessPatch } from './profile.js'

export async function spawnWorkbench(): Promise<{ child: ChildProcess; temporaryDirectory: string }> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'hulala-harness-'))
  const patchPath = join(temporaryDirectory, 'profile.patch.json')
  await writeFile(patchPath, JSON.stringify(createPackagedHarnessPatch()), 'utf8')

  const require = createRequire(import.meta.url)
  const dshBin = require.resolve('@deepseek-ai/dsh/lib/bin.js')
  const child = spawn(process.execPath, [
    dshBin,
    'web',
    '--patch', patchPath,
    '--host', APP_HOST,
    '--port', String(WORKBENCH_PORT),
    '--trusted-host', APP_AUTHORITY,
    '--no-open',
  ], {
    stdio: 'inherit',
    env: { ...process.env, HULALA_VERSION: VERSION },
  })

  return { child, temporaryDirectory }
}
