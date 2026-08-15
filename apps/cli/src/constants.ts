declare const __LOOPWITHAI_VERSION__: string | undefined

export const APP_NAME = 'loopwithai'
export const APP_HOST = '127.0.0.1'
const configuredPort = Number(process.env.LOOPWITHAI_PORT ?? 3210)
export const APP_PORT = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
  ? configuredPort
  : 3210
export const APP_AUTHORITY = `loopwithai.localhost:${APP_PORT}`
export const APP_URL = `http://${APP_AUTHORITY}/`
const configuredWorkbenchPort = Number(process.env.LOOPWITHAI_WORKBENCH_PORT ?? APP_PORT + 1)
export const WORKBENCH_PORT = Number.isInteger(configuredWorkbenchPort) && configuredWorkbenchPort > 0 && configuredWorkbenchPort <= 65_535
  ? configuredWorkbenchPort
  : APP_PORT + 1
export const HEALTH_URL = `http://${APP_HOST}:${APP_PORT}/api/loopwithai/health`
export const WORKBENCH_HEALTH_URL = `http://${APP_HOST}:${WORKBENCH_PORT}/api/loopwithai/health`
export const CLOUD_URL = 'https://loopwith.ai/'
export const VERSION = typeof __LOOPWITHAI_VERSION__ === 'string' ? __LOOPWITHAI_VERSION__ : '0.1.0'
