import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

const root = join(import.meta.dirname, '..', 'dist')
const forbiddenExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.map', '.d.ts'])
const violations: string[] = []
const forbiddenMarkers = ['/Users/colin/code/', 'openbrain-dev', 'hulala-dev/apps/server/src', 'apps/server/src']

async function inspect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await inspect(path)
    else {
      if (forbiddenExtensions.has(extname(entry.name)) || entry.name.endsWith('.d.ts')) violations.push(path)
      const bytes = await readFile(path)
      const text = bytes.toString('latin1')
      for (const marker of forbiddenMarkers) {
        if (text.includes(marker)) violations.push(`${path}: contains ${marker}`)
      }
    }
  }
}

await inspect(root)
if (violations.length) {
  console.error(`source-like files found in the Host bundle:\n${violations.join('\n')}`)
  process.exit(1)
}
console.log('Host bundle contains compiled artifacts only')
