import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function ensureBrowserDataFormat(root: string): Promise<void> {
  const directory = join(root, 'server'), marker = join(directory, 'browser-data-format.json')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try { await writeFile(marker, '{"format":1}\n', { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const state = JSON.parse(await readFile(marker, 'utf8')) as { format?: unknown }
  if (state.format !== 1) throw new Error('This Hulala version cannot read the browser data format. Use a compatible version or restore a compatible backup.')
}
