import { spawn } from 'node:child_process'

export interface BrowserLaunch {
  command: string
  args: string[]
}

export function browserLaunch(url: string, platform: NodeJS.Platform = process.platform): BrowserLaunch {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
  return { command: 'xdg-open', args: [url] }
}

export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const launch = browserLaunch(url, platform)
  const child = spawn(launch.command, launch.args, { detached: true, stdio: 'ignore' })
  child.on('error', error => console.warn(`Hulala could not open the browser automatically: ${error.message}`))
  child.unref()
}
