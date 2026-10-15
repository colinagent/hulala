import { spawn } from 'node:child_process'
import { posix, win32 } from 'node:path'

export interface BrowserLaunch {
  command: string
  args: string[]
}

export function browserLaunch(url: string, platform: NodeJS.Platform = process.platform, executable?: string): BrowserLaunch {
  if (executable) {
    if (!(platform === 'win32' ? win32 : posix).isAbsolute(executable) || executable.includes('\0')) throw new Error('HULALA_BROWSER must be an absolute executable path')
    return { command: executable, args: [url] }
  }
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe'), args: ['url.dll,FileProtocolHandler', url] }
  return { command: 'xdg-open', args: [url] }
}

export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  let launch: BrowserLaunch
  try { launch = browserLaunch(url, platform, process.env.HULALA_BROWSER) }
  catch (error) { console.warn(`${error instanceof Error ? error.message : error}. Open ${url}`); return }
  const child = spawn(launch.command, launch.args, { detached: true, stdio: 'ignore' })
  child.on('error', error => console.warn(`Hulala could not open the browser automatically: ${error.message}`))
  child.on('exit', code => { if (code !== null && code !== 0) console.warn(`Browser launcher exited with code ${code}. Open ${url}`) })
  child.unref()
}
