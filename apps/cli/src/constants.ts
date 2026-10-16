declare const __HULALA_VERSION__: string | undefined

export const APP_NAME = 'hulala'
export const APP_HOST = '127.0.0.1'
export const APP_BROWSER_HOST = 'hulala.localhost'
const configuredPort = Number(process.env.HULALA_PORT ?? 3210)
export const APP_PORT = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
  ? configuredPort
  : 3210
export const APP_AUTHORITY = new URL(`http://${APP_BROWSER_HOST}:${APP_PORT}`).host
export const APP_URL = `http://${APP_AUTHORITY}/`
const configuredWorkbenchPort = Number(process.env.HULALA_WORKBENCH_PORT ?? APP_PORT + 1)
export const WORKBENCH_PORT = Number.isInteger(configuredWorkbenchPort) && configuredWorkbenchPort > 0 && configuredWorkbenchPort <= 65_535
  ? configuredWorkbenchPort
  : APP_PORT + 1
export const HEALTH_URL = `http://${APP_HOST}:${APP_PORT}/api/hulala/health`
export const WORKBENCH_HEALTH_URL = `http://${APP_HOST}:${WORKBENCH_PORT}/api/hulala/health`
export const VERSION = typeof __HULALA_VERSION__ === 'string' ? __HULALA_VERSION__ : '0.1.5'
