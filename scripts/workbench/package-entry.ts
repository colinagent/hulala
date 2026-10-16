import { dirname, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { verifyPackage } from './package-manifest'
import { launcherInstallation } from '../../apps/cli/src/distribution/install'
import { runInstalledLauncher } from '../../apps/cli/src/distribution/launcher'
import { applyAutostartEnvironment } from '../../apps/cli/src/autostart-environment'
import { completeDeferredUninstall } from '../../apps/cli/src/distribution/deferred-uninstall'
import { withProgress, showStartupProgress } from '../../apps/cli/src/progress'

declare const HULALA_PACKAGE_VERSION: string
async function main(): Promise<void> {
  const args = await applyAutostartEnvironment(process.argv.slice(2))
  if (args[0] === '__complete-uninstall' && args.length === 2) {
    try { await completeDeferredUninstall(args[1]!) }
    catch (error) { console.error(error instanceof Error ? error.message : 'Uninstall failed'); process.exit(1) }
    process.exit(0)
  }
  const executable = await realpath(process.execPath)
  const installation = await launcherInstallation(executable)
  if (installation) { process.exitCode = await runInstalledLauncher(installation, args); return }
  if (args.length === 1 && ['--version', '-V'].includes(args[0]!)) { console.log(HULALA_PACKAGE_VERSION); return }
  const packageRoot = resolve(dirname(executable), '..')
  if (['install', 'doctor', '--help', '-h'].includes(args[0] || '') && !await Bun.file(resolve(packageRoot, 'manifest.json')).exists()) {
    delete process.env.HULALA_PACKAGE_ROOT
    process.env.HULALA_INSTALL_SOURCE = 'installer'
    const { runCli } = await import('../../apps/cli/src/cli')
    process.exitCode = await runCli(args); return
  }
  const manifest = await withProgress('Checking runtime files', () => verifyPackage(packageRoot), showStartupProgress(args))
  if (manifest.version !== HULALA_PACKAGE_VERSION || manifest.target !== `${process.platform}-${process.arch}`) throw new Error('Package metadata does not match this executable')
  if (args.length === 1 && args[0] === '--check-package') {
    console.log(JSON.stringify({ valid: true, stage: manifest.stage, version: manifest.version, target: manifest.target, files: manifest.files.length })); return
  }
  if (manifest.stage !== 'workbench') throw new Error('This foundation artifact cannot start the browser workbench')
  process.env.HULALA_PACKAGE_ROOT = packageRoot
  process.env.HULALA_INSTALL_SOURCE ||= process.env.HULALA_INSTALL_ROOT ? 'standalone' : 'archive'
  const { runCli } = await import('../../apps/cli/src/cli')
  process.exitCode = await runCli(args)
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Hulala could not start'); process.exitCode = 1 })
