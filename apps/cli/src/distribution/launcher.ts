import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { access } from 'node:fs/promises'
import { installedDirectory, readInstallation, verifyInstalled } from './install.js'

export async function runInstalledLauncher(root: string, args: string[]): Promise<number> {
  if (await access(join(root, 'removal.json')).then(() => true, () => false)) throw new Error('Hulala removal is in progress. Check the completion result in the Hulala logs directory.')
  const active = await readInstallation(root)
  const manifest = await verifyInstalled(root, active.current)
  const directory = installedDirectory(root, active.current)
  return new Promise((resolve, reject) => {
    const child = spawn(join(directory, manifest.entrypoint), args, { stdio: 'inherit', windowsHide: true,
      env: { ...process.env, HULALA_INSTALL_ROOT: root, HULALA_INSTALL_SOURCE: 'standalone', HULALA_PACKAGE_ROOT: directory, HULALA_LAUNCHER_PID: String(process.pid) },
    })
    const forward = (signal: NodeJS.Signals) => { child.kill(signal) }
    const cleanup = () => { process.removeListener('SIGINT', forward); process.removeListener('SIGTERM', forward) }
    process.on('SIGINT', forward); process.on('SIGTERM', forward)
    child.once('error', error => { cleanup(); reject(error) })
    child.once('exit', (code, signal) => { cleanup(); resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)) })
  })
}
