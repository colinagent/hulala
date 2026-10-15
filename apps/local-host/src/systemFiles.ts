import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import type { Workspace } from '@hulala/workbench-contracts'
import { resolveWorkspacePath } from './files'
import { HttpError } from './http'

export async function openSystemFile(workspace: Workspace, requestedPath: string, reveal: boolean): Promise<void> {
  const path = await resolveWorkspacePath(workspace, requestedPath)
  const argv = process.platform === 'darwin' ? ['open', ...(reveal ? ['-R'] : []), '--', path]
    : process.platform === 'win32' ? ['explorer.exe', ...(reveal ? ['/select,', path] : [path])]
      : ['xdg-open', reveal ? dirname(path) : path]
  await new Promise<void>((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { stdio: 'ignore', windowsHide: true })
    child.once('error', () => reject(new HttpError(503, 'system_open_unavailable', 'No system file opener is available. Download the file or copy its path instead.')))
    child.once('exit', code => code === 0 || (process.platform === 'win32' && code === 1) ? resolve() : reject(new HttpError(500, 'system_open_failed', 'The system could not open this file.')))
  })
}
