import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

export interface PowerState { supported: boolean; active: boolean; error?: string }
type Release = () => Promise<void>
type Acquire = (lost: () => void) => Promise<Release>

async function systemInhibitor(platform: NodeJS.Platform, lost: () => void): Promise<Release> {
  if (platform === 'win32') {
    const koffi = await import('koffi')
    const library = koffi.load('kernel32.dll')
    const setState = library.func('uint32_t __stdcall SetThreadExecutionState(uint32_t flags)')
    if (!setState(0x80000001)) { library.unload(); throw new Error('Windows refused the sleep-prevention request') }
    return async () => { if (!setState(0x80000000)) throw new Error('Windows could not release sleep prevention'); library.unload() }
  }
  const linuxReady = 'hulala-inhibit-ready'
  const executable = platform === 'darwin' ? '/usr/bin/caffeinate' : Bun.which('systemd-inhibit')
  if (!executable) throw new Error('Sleep prevention is unavailable on this system')
  const args = platform === 'darwin' ? ['-i', '-w', String(process.pid)] : [
    '--what=idle', '--mode=block', '--who=Hulala', '--why=Keep local background tasks running',
    process.execPath, '-e', `console.log(${JSON.stringify(linuxReady)});setInterval(()=>{try{process.kill(${process.pid},0)}catch{process.exit(0)}},1000)`,
  ]
  const child = spawn(executable, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let releasing = false, exited = false
  const exit = new Promise<void>(resolve => { child.once('exit', () => { exited = true; if (!releasing) lost(); resolve() }); child.once('error', () => { exited = true; resolve() }) })
  child.stderr?.resume()
  const release = async () => {
    releasing = true
    if (exited) return
    try { if (child.pid) process.kill(-child.pid, 'SIGTERM') } catch {}
    const force = setTimeout(() => { try { if (child.pid && !exited) process.kill(-child.pid, 'SIGKILL') } catch {} }, 1000)
    try { await exit } finally { clearTimeout(force) }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => platform === 'darwin' ? resolve() : reject(new Error('The system sleep inhibitor did not become ready')), platform === 'darwin' ? 200 : 3000)
      child.once('error', () => { clearTimeout(timer); reject(new Error('Could not start system sleep prevention')) })
      child.once('exit', () => { clearTimeout(timer); reject(new Error('The system denied sleep prevention')) })
      child.stdout?.on('data', bytes => { if (String(bytes).includes(linuxReady)) { clearTimeout(timer); resolve() } })
    })
    return release
  } catch (error) { await release(); throw error }
}

/** Owned by the local service, so closing a browser view cannot release it. */
export class SleepPrevention {
  private release?: Release
  private tail: Promise<unknown> = Promise.resolve()
  private state: PowerState
  private readonly acquire: Acquire
  constructor(platform: NodeJS.Platform = process.platform, acquire?: Acquire, private readonly changed = () => {}) {
    this.acquire = acquire || (lost => systemInhibitor(platform, lost))
    this.state = { supported: !!(acquire || platform === 'win32' || (platform === 'darwin' && existsSync('/usr/bin/caffeinate')) || (platform === 'linux' && Bun.which('systemd-inhibit'))), active: false }
  }
  snapshot(): PowerState { return { ...this.state } }
  apply(enabled: boolean): Promise<void> {
    const operation = this.tail.then(async () => {
      if (enabled === this.state.active) { if (!enabled && this.state.error) { this.state = { supported: this.state.supported, active: false }; this.changed() }; return }
      if (!enabled) { await this.release?.(); this.release = undefined; this.state = { supported: this.state.supported, active: false }; this.changed(); return }
      if (!this.state.supported) throw new Error('This system cannot prevent idle sleep through Hulala. Use its power settings.')
      try {
        this.release = await this.acquire(() => { this.release = undefined; this.state = { supported: this.state.supported, active: false, error: 'System sleep prevention stopped unexpectedly' }; this.changed() })
        this.state = { supported: true, active: true }; this.changed()
      } catch (error) { this.state = { supported: this.state.supported, active: false, error: error instanceof Error ? error.message : 'Could not prevent idle sleep' }; this.changed(); throw error }
    })
    this.tail = operation.catch(() => undefined)
    return operation
  }
  stop() { return this.apply(false) }
}
