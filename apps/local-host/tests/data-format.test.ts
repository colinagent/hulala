import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureBrowserDataFormat } from '../src/browser/data-format'

test('initial data format setup is atomic and refuses a newer existing format', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala data format '))
  try {
    await Promise.all([ensureBrowserDataFormat(root), ensureBrowserDataFormat(root)])
    const marker = join(root, 'server/browser-data-format.json')
    expect(JSON.parse(await readFile(marker, 'utf8'))).toEqual({ format: 1 })
    if (process.platform !== 'win32') expect((await stat(marker)).mode & 0o777).toBe(0o600)
    await writeFile(marker, '{"format":2}')
    await expect(ensureBrowserDataFormat(root)).rejects.toThrow('compatible version')
    expect(await readFile(marker, 'utf8')).toBe('{"format":2}')
  } finally { await rm(root, { recursive: true, force: true }) }
})
