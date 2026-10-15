import type { BrowserServiceInfo } from '@hulala/workbench-contracts/browser'
export function browserServiceInfo(version: string): BrowserServiceInfo {
  const value = process.env.HULALA_INSTALL_SOURCE
  const source: BrowserServiceInfo['source'] = process.env.HULALA_INSTALL_ROOT ? 'standalone' : ['npm', 'npx', 'bun', 'pnpm', 'archive'].includes(value || '') ? value as BrowserServiceInfo['source'] : 'source'
  const commands: Record<BrowserServiceInfo['source'], string | null> = {
    source: null, archive: process.platform === 'win32' ? '.\\bin\\hulala.exe install --add-to-path' : './bin/hulala install --add-to-path', standalone: 'hulala update',
    npm: 'npm install -g hulala@latest', npx: 'npx hulala@latest service shutdown\nnpx hulala@latest', bun: 'bun install -g hulala@latest', pnpm: 'pnpm add -g hulala@latest',
  }
  return { version, source, updateCommand: commands[source], restartCommand: source === 'source' || source === 'archive' ? null : source === 'npx' ? `npx hulala@${version} service restart` : source === 'standalone' ? 'hulala service restart' : 'hulala service shutdown\nhulala' }
}
