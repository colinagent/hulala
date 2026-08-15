import { homedir } from 'node:os'
import path from 'node:path'

export interface LoopWithAIPaths {
  data: string
  logs: string
  launcherLog: string
  serviceRoot: string
  serviceEntry: string
  versionsRoot: string
  activeManifest: string
  autostartFile?: string
}

export function resolvePaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): LoopWithAIPaths {
  const join = platform === 'win32' ? path.win32.join : path.posix.join
  let data: string
  let logs: string
  if (platform === 'darwin') {
    data = join(userHome, 'Library', 'Application Support', 'LoopWithAI')
    logs = join(userHome, 'Library', 'Logs', 'LoopWithAI')
  } else if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || join(userHome, 'AppData', 'Local')
    data = join(localAppData, 'LoopWithAI')
    logs = join(data, 'logs')
  } else {
    data = join(env.XDG_DATA_HOME || join(userHome, '.local', 'share'), 'loopwithai')
    logs = join(env.XDG_STATE_HOME || join(userHome, '.local', 'state'), 'loopwithai')
  }
  const serviceRoot = join(data, 'service')
  const autostartFile = platform === 'darwin'
    ? join(userHome, 'Library', 'LaunchAgents', 'ai.loopwith.loopwithai.plist')
    : platform === 'win32'
      ? join(serviceRoot, 'LoopWithAI-task.xml')
      : undefined
  return {
    data,
    logs,
    launcherLog: join(logs, 'launcher.log'),
    serviceRoot,
    serviceEntry: join(serviceRoot, 'launcher.mjs'),
    versionsRoot: join(serviceRoot, 'versions'),
    activeManifest: join(serviceRoot, 'active.json'),
    ...(autostartFile === undefined ? {} : { autostartFile }),
  }
}
