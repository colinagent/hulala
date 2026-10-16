import type { WorkbenchPlatform } from '../renderer/types/platform'

/** Install concrete capabilities before loading the renderer. No generic IPC is exposed. */
export function installWorkbenchPlatform(platform: WorkbenchPlatform): void {
  if (window.hulala) throw new Error('Workbench platform already installed')
  Object.defineProperty(window, 'hulala', { value: platform, configurable: false, writable: false })
}

export function requireWorkbenchPlatform(): WorkbenchPlatform {
  if (!window.hulala) throw new Error('The browser Host connection is not installed in this stage-1 build.')
  return window.hulala
}
