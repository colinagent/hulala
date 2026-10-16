declare const __HULALA_VERSION__: string | undefined

export const APP_NAME = 'hulala'
export const APP_HOST = '127.0.0.1'
export const APP_BROWSER_HOST = 'hulala.localhost'
export const validPort = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65535
export const PREFERRED_PORT = validPort(Number(process.env.HULALA_PORT)) ? Number(process.env.HULALA_PORT) : 80
export const PREFERRED_WORKBENCH_PORT = validPort(Number(process.env.HULALA_WORKBENCH_PORT)) ? Number(process.env.HULALA_WORKBENCH_PORT) : 3211
export let APP_PORT = PREFERRED_PORT
export let WORKBENCH_PORT = PREFERRED_WORKBENCH_PORT
export let APP_AUTHORITY: string, APP_URL: string, HEALTH_URL: string, WORKBENCH_HEALTH_URL: string
export function configurePorts(port: number, workbenchPort: number): void {
  if (!validPort(port) || !validPort(workbenchPort) || port === workbenchPort) throw new Error('Invalid Hulala service ports')
  APP_PORT = port
  WORKBENCH_PORT = workbenchPort
  APP_AUTHORITY = new URL(`http://${APP_BROWSER_HOST}:${port}`).host
  APP_URL = `http://${APP_AUTHORITY}/`
  HEALTH_URL = `http://${APP_HOST}:${port}/api/hulala/health`
  WORKBENCH_HEALTH_URL = `http://${APP_HOST}:${workbenchPort}/api/hulala/health`
}
configurePorts(APP_PORT, WORKBENCH_PORT === APP_PORT ? (APP_PORT === 65535 ? 3211 : APP_PORT + 1) : WORKBENCH_PORT)
export const VERSION = typeof __HULALA_VERSION__ === 'string' ? __HULALA_VERSION__ : '0.1.6'
