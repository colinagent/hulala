import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'

import type { HulalaPaths } from './paths.js'

export async function startDetached(entryPath: string, paths: HulalaPaths): Promise<number | undefined> {
  await mkdir(paths.logs, { recursive: true })
  const log = openSync(paths.launcherLog, 'a')
  try {
    const child = spawn(process.execPath, [...(process.env.HULALA_PACKAGE_ROOT ? [] : [entryPath]), '__serve'], {
      cwd: paths.data,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
      env: { ...process.env, HULALA_DAEMON: '1' },
    })
    child.unref()
    return child.pid
  } finally {
    closeSync(log)
  }
}
