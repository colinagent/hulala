import { homedir } from 'node:os'
import path from 'node:path'

export interface HulalaPaths {
  data: string
  logs: string
  launcherLog: string
}

export function resolvePaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): HulalaPaths {
  const join = platform === 'win32' ? path.win32.join : path.posix.join
  const paths = platform === 'win32' ? path.win32 : path.posix
  const configuredRoot = env.HULALA_HOME?.trim()
  if (configuredRoot && !paths.isAbsolute(configuredRoot)) throw new Error('HULALA_HOME must be an absolute path')
  const data = paths.normalize(configuredRoot || join(userHome, '.hulala'))
  const logs = join(data, 'logs')
  return {
    data,
    logs,
    launcherLog: join(logs, 'host.log'),
  }
}
