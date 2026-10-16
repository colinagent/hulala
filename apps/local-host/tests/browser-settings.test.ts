import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserSettings } from '../src/browser/settings'

test('concurrent preference patches retain each field and external edits notify other views', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-settings-'))
  const settings = new BrowserSettings(root, join(import.meta.dir, '../../workbench/settings'))
  try {
    await settings.initialize()
    await Promise.all([settings.set({ ui: { themeId: 'default-dark' } } as any), settings.set({ ui: { displayLocale: 'zh-CN' } } as any)])
    expect((await settings.get()).ui).toMatchObject({ themeId: 'default-dark', displayLocale: 'zh-CN' })
    let changed = 0
    settings.watch(() => changed++)
    await writeFile(join(root, 'config/ui.jsonc'), JSON.stringify({ version: 1, themeId: 'system', displayLocale: 'en' }))
    const deadline = Date.now() + 4000
    while (!changed && Date.now() < deadline) await Bun.sleep(25)
    expect(changed).toBeGreaterThan(0)
    expect((await settings.get()).ui).toMatchObject({ themeId: 'system', displayLocale: 'en' })
    settings.stop()
    const before = changed
    await writeFile(join(root, 'config/ui.jsonc'), JSON.stringify({ version: 1, themeId: 'default-light' }))
    await Bun.sleep(150)
    expect(changed).toBe(before)
  } finally { settings.stop(); await rm(root, { recursive: true, force: true }) }
})
