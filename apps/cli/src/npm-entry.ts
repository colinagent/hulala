import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stablePackage } from './distribution/cache.js'
import { platformPackage, releaseTarget } from '@hulala/distribution/targets'
import { resolvePaths } from './paths.js'
import { applyAutostartEnvironment } from './autostart-environment.js'

declare const __HULALA_VERSION__: string
async function main(): Promise<void> {
  const args = await applyAutostartEnvironment(process.argv.slice(2))
  const name = platformPackage(releaseTarget())
  let packageRoot: string
  try { packageRoot = dirname(createRequire(import.meta.url).resolve(name + '/package.json')) }
  catch { throw new Error(`Missing platform dependency ${name}. Reinstall with optional dependencies enabled: npm install -g hulala@${__HULALA_VERSION__}`) }
  const directory = await stablePackage(join(packageRoot, 'vendor'), resolvePaths().data, __HULALA_VERSION__)
  const owner = dirname(dirname(fileURLToPath(import.meta.url)))
  const source = /[/\\]_npx[/\\]/.test(owner) ? 'npx' : /[/\\]\.bun[/\\]/.test(owner) || process.env.npm_config_user_agent?.startsWith('bun/') ? 'bun'
    : /[/\\]\.pnpm[/\\]/.test(owner) || process.env.npm_config_user_agent?.startsWith('pnpm/') ? 'pnpm' : 'npm'
  const child = spawn(join(directory, 'bin', process.platform === 'win32' ? 'hulala.exe' : 'hulala'), args, {
    stdio: 'inherit', env: { ...process.env, HULALA_INSTALL_SOURCE: source, HULALA_NPM_PACKAGE_ROOT: owner, HULALA_NODE_EXECUTABLE: process.execPath,
      HULALA_PACKAGE_ROOT: directory }, windowsHide: true,
  })
  const forward = (signal: NodeJS.Signals) => { child.kill(signal) }
  process.on('SIGINT', forward); process.on('SIGTERM', forward)
  child.once('error', error => { console.error(`Hulala could not start: ${error.message}`); process.exitCode = 1 })
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', forward); process.removeListener('SIGTERM', forward)
    if (signal) process.kill(process.pid, signal)
    else process.exitCode = code ?? 1
  })
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
