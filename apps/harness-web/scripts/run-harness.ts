import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createHarnessPatch } from './harness-profile.js'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'hulala-harness-'))
const patchPath = join(temporaryDirectory, 'profile.patch.json')
await writeFile(patchPath, JSON.stringify(createHarnessPatch(repositoryRoot)), 'utf8')

const require = createRequire(import.meta.url)
const dshBin = require.resolve('@deepseek-ai/dsh/lib/bin.js')
const child = spawn(process.execPath, [dshBin, 'web', '--patch', patchPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})

const forward = (signal: NodeJS.Signals): void => { child.kill(signal) }
const onInterrupt = (): void => forward('SIGINT')
const onTerminate = (): void => forward('SIGTERM')
process.on('SIGINT', onInterrupt)
process.on('SIGTERM', onTerminate)

try {
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : result.signal === 'SIGTERM' ? 143 : 1)
} finally {
  process.off('SIGINT', onInterrupt)
  process.off('SIGTERM', onTerminate)
  await rm(temporaryDirectory, { recursive: true, force: true })
}
