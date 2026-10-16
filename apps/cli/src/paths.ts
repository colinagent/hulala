import { homedir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, realpath } from 'node:fs/promises'

export interface HulalaPaths {
  data: string
  logs: string
  launcherLog: string
  serviceRoot: string
  autostartName: string
  autostartConfig: string
  autostartFile?: string
}

export async function launcherStateIdentity(paths = resolvePaths()): Promise<string> {
  await mkdir(paths.data, { recursive: true, mode: 0o700 })
  return createHash('sha256').update(await realpath(paths.data)).digest('hex')
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
  const data = paths.normalize(configuredRoot || join(userHome, '.config', 'hulala'))
  const logs = join(data, 'logs')
  const serviceRoot = join(data, 'runtime', 'launcher')
  const identity = createHash('sha256').update(data).digest('hex').slice(0, 12)
  const autostartName = platform === 'darwin' ? 'ai.hulala.browser.' + identity : 'hulala-browser-' + identity
  const autostartFile = platform === 'darwin'
    ? join(userHome, 'Library', 'LaunchAgents', autostartName + '.plist')
    : platform === 'win32'
      ? join(serviceRoot, 'Hulala-task.xml')
      : platform === 'linux' ? join(userHome, '.config/systemd/user', autostartName + '.service') : undefined
  return {
    data,
    logs,
    launcherLog: join(logs, 'launcher.log'),
    serviceRoot,
    autostartName,
    autostartConfig: join(serviceRoot, 'autostart.json'),
    ...(autostartFile === undefined ? {} : { autostartFile }),
  }
}
