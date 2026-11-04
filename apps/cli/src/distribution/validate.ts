import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Prove a candidate package's CLI runs and reports the expected version.
 *
 * The Host is a separate daemon; installation must not boot or health-check a
 * browser workbench. A version probe is enough to reject a broken or foreign
 * executable before activation.
 */
export async function validateNativeCandidate(directory: string, version: string): Promise<void> {
  const state = await mkdtemp(join(tmpdir(), 'hulala candidate '))
  const executable = join(directory, 'bin', process.platform === 'win32' ? 'hulala.exe' : 'hulala')
  const child = spawn(executable, ['--version'], {
    cwd: state,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      HULALA_HOME: join(state, 'state'),
      HULALA_WORKSPACE_ROOT: join(state, 'workspaces'),
      HULALA_INSTALL_ROOT: undefined,
      HULALA_REPOSITORY_ROOT: undefined,
    },
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => { stdout = (stdout + String(chunk)).slice(-4096) })
  child.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4096) })
  const completed = new Promise<number | null>(resolve => {
    child.once('exit', code => resolve(code))
    child.once('error', error => { stderr = error.message; resolve(null) })
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const code = await Promise.race([
      completed,
      new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 15_000) }),
    ])
    if (code !== 0 || stdout.trim() !== version) {
      throw new Error(`Candidate ${version} did not report its version${stderr ? `: ${stderr.trim()}` : ''}`)
    }
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null && child.pid !== undefined) {
      if (process.platform === 'win32') {
        spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      } else {
        child.kill('SIGKILL')
      }
    }
    await rm(state, { recursive: true, force: true })
  }
}
