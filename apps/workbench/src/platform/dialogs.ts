import type { DirectoryPickerProvider } from '../renderer/components/FileDialog/DirectoryPickerDialog'
export type BrowserDirectoryRequest = { id: string; defaultPath?: string; mode?: 'openFile'; title?: string; provider?: DirectoryPickerProvider; resolve(value: string | null): void }
export const DIRECTORY_REQUEST_EVENT = 'hulala:directory-request'
export type BrowserSecretRequest = { plugin: string; name: string; save(value: string): Promise<unknown>; resolve(saved: boolean): void }
export const SECRET_REQUEST_EVENT = 'hulala:secret-request'
export function configureBrowserSecret(plugin: string, name: string, save: BrowserSecretRequest['save']): Promise<boolean> {
  return new Promise(resolve => window.dispatchEvent(new CustomEvent(SECRET_REQUEST_EVENT, { detail: { plugin, name, save, resolve } satisfies BrowserSecretRequest })))
}

export function chooseDirectory(defaultPath?: string, options: { mode?: 'openFile'; title?: string; provider?: DirectoryPickerProvider } = {}): Promise<string | null> {
  return new Promise(resolve => {
    const detail: BrowserDirectoryRequest = { id: crypto.randomUUID(), defaultPath, ...options, resolve }
    window.dispatchEvent(new CustomEvent(DIRECTORY_REQUEST_EVENT, { detail }))
  })
}
