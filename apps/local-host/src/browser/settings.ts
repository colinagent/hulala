import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { constants, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ensureSettingsInitialized, loadAllSettings, saveSettings, type SettingsState } from '../settings/settingsStore'

export class BrowserSettings {
  private writes: Promise<unknown> = Promise.resolve()
  private watcher?: FSWatcher
  private timer?: ReturnType<typeof setTimeout>
  private poller?: ReturnType<typeof setInterval>
  private watchGeneration = 0
  constructor(readonly root: string, readonly templates: string) {}
  async initialize(): Promise<void> {
    await mkdir(join(this.root, 'config'), { recursive: true, mode: 0o700 })
    for (const entry of await readdir(this.templates)) {
      if (!/^[a-z-]+\.jsonc$/.test(entry)) continue
      await copyFile(join(this.templates, entry), join(this.root, 'config', entry), constants.COPYFILE_EXCL).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      })
    }
    await ensureSettingsInitialized(homedir(), join(this.root, 'config'))
  }
  async get(): Promise<SettingsState> { await this.writes; return loadAllSettings(homedir(), join(this.root, 'config')) }
  watch(changed: () => void): void {
    this.stop()
    const generation = ++this.watchGeneration
    const notify = () => { if (generation !== this.watchGeneration) return; clearTimeout(this.timer); this.timer = setTimeout(changed, 100) }
    const polling = () => {
      if (generation !== this.watchGeneration || this.poller) return
      let snapshot = '', reading = false
      this.poller = setInterval(() => {
        if (reading) return; reading = true
        void this.get().then(value => { const next = JSON.stringify(value); if (next !== snapshot) { snapshot = next; notify() } }).catch(() => undefined).finally(() => { reading = false })
      }, 2500)
      this.poller.unref()
    }
    try {
      this.watcher = watch(join(this.root, 'config'), { persistent: false }, (_event, filename) => { if (!filename || /^[a-z-]+\.jsonc$/.test(String(filename))) notify() })
      this.watcher.on('error', () => { if (generation !== this.watchGeneration) return; this.watcher?.close(); polling() })
    } catch { polling() }
    // Some filesystems miss replacement/early events without emitting an error.
    // A low-frequency snapshot also covers those cases across browser profiles.
    polling()
  }
  stop(): void { this.watchGeneration++; clearTimeout(this.timer); clearInterval(this.poller); this.poller = undefined; this.watcher?.close(); this.watcher = undefined }
  set(value: Partial<SettingsState>): Promise<SettingsState> {
    const write = this.writes.then(() => saveSettings(homedir(), value, join(this.root, 'config')))
    this.writes = write.catch(() => undefined)
    return write
  }
}
