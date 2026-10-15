import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Installation, installationReceipt, withInstallationLock } from './install.js'
import { readdir } from 'node:fs/promises'
import { removeCommandPath } from './path.js'

interface UninstallPlan { format: 1; product: 'hulala-uninstall'; root: string; stateRoot: string; launcherSha256: string; waitFor: number[] }
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error } }
export async function deferWindowsUninstall(root: string, stateRoot: string): Promise<string> {
  const id = randomUUID(), directory = join(stateRoot, 'cache/uninstall', id), result = join(stateRoot, 'logs', 'uninstall-' + id + '.json')
  await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(dirname(result), { recursive: true, mode: 0o700 })
  const receipt = await installationReceipt(root), executable = join(directory, 'hulala-uninstall.exe'), plan = join(directory, 'plan.json')
  await cp(process.execPath, executable)
  const waitFor = [process.pid]
  if (Number(process.env.HULALA_LAUNCHER_PID) === process.ppid) waitFor.push(process.ppid)
  const value: UninstallPlan = { format: 1, product: 'hulala-uninstall', root, stateRoot, launcherSha256: receipt.launcherSha256, waitFor }
  await writeFile(plan, JSON.stringify(value), { mode: 0o600 })
  const pending = join(root, 'removal.json')
  await writeFile(pending, JSON.stringify({ format: 1, id, result }), { flag: 'wx', mode: 0o600 })
  const log = openSync(join(directory, 'helper.log'), 'a', 0o600)
  try {
    const child = spawn(executable, ['__complete-uninstall', plan], { detached: true, stdio: ['ignore', log, log], windowsHide: true, env: process.env })
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    child.unref()
  } catch (error) { await rm(pending, { force: true }); throw error }
  finally { closeSync(log) }
  return result
}
export async function completeDeferredUninstall(filename: string): Promise<void> {
  filename = await realpath(filename)
  const plan = JSON.parse(await readFile(filename, 'utf8')) as UninstallPlan
  if (plan.format !== 1 || plan.product !== 'hulala-uninstall' || !isAbsolute(plan.root) || !isAbsolute(plan.stateRoot) || !/^[a-f0-9]{64}$/.test(plan.launcherSha256) || !Array.isArray(plan.waitFor) || plan.waitFor.length > 2 || plan.waitFor.some(pid => !Number.isInteger(pid) || pid <= 0 || pid === process.pid)) throw new Error('Invalid deferred uninstall plan')
  const directory = dirname(filename), id = basename(directory)
  const cache = await realpath(join(plan.stateRoot, 'cache/uninstall'))
  if (relative(cache, directory).split(sep).length !== 1 || !/^[a-f0-9-]{36}$/.test(id) || basename(filename) !== 'plan.json') throw new Error('Uninstall plan is outside its owned staging directory')
  const result = join(plan.stateRoot, 'logs', 'uninstall-' + id + '.json')
  await mkdir(dirname(result), { recursive: true, mode: 0o700 })
  try {
    const deadline = Date.now() + 60000
    while (plan.waitFor.some(alive)) {
      if (Date.now() > deadline) throw new Error('The invoking launcher is still running; installation files were retained')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    await withInstallationLock(plan.root, async () => {
      const pending = JSON.parse(await readFile(join(plan.root, 'removal.json'), 'utf8'))
      if (pending.id !== id) throw new Error('Uninstall reservation has changed')
      const receipt = await installationReceipt(plan.root)
      if (receipt.launcherSha256 !== plan.launcherSha256) throw new Error('The installation changed after uninstall was scheduled')
      const installation = new Installation(plan.root, plan.stateRoot)
      const removed = await installation.uninstall()
      if (receipt.pathRegistration && (await readdir(dirname(receipt.command))).length === 0) await removeCommandPath(receipt.pathRegistration)
      await writeFile(result, JSON.stringify({ removed: true, userDataPreserved: true, preserved: removed.preserved }) + '\n', { mode: 0o600 })
    })
  } catch (error) {
    await writeFile(result, JSON.stringify({ removed: false, error: error instanceof Error ? error.message : 'Uninstall failed' }) + '\n', { mode: 0o600 })
    throw error
  } finally {
    const pending = await readFile(join(plan.root, 'removal.json'), 'utf8').then(text => JSON.parse(text), () => null)
    if (pending?.id === id) await rm(join(plan.root, 'removal.json'), { force: true })
    if (process.platform === 'win32') {
      // Windows keeps a mapped executable locked. A short-lived OS helper waits
      // for this process, then removes only its UUID-named temporary directory.
      const cleanup = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `Wait-Process -Id ${process.pid} -Timeout 60 -ErrorAction SilentlyContinue; if(!(Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)){Remove-Item -LiteralPath $env:HULALA_UNINSTALL_CACHE -Recurse -Force}`], {
        detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, HULALA_UNINSTALL_CACHE: directory },
      })
      cleanup.on('error', () => {}); cleanup.unref()
    }
  }
}
