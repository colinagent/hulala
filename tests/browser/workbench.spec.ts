import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const repository = join(import.meta.dirname, '../..')
let child: ChildProcess, root: string, fixture: { url: string; workspace: string; second: string; workspaceId: string }
test.beforeAll(async ({ browser }, info) => {
  console.log(JSON.stringify({ browser: info.project.name, version: browser.version(), host: process.platform }))
  root = await mkdtemp(join(tmpdir(), 'hulala browser acceptance '))
  const bun = createRequire(import.meta.url).resolve('bun/bin/bun.exe')
  child = spawn(bun, [join(repository, 'scripts/workbench/browser-fixture.ts'), '--root', root, '--web', process.env.HULALA_WEB_OUTPUT || join(repository, 'apps/workbench/dist')], { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] })
  let errors = '', output = ''
  child.stderr?.on('data', chunk => { errors = (errors + String(chunk)).slice(-8000) })
  fixture = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser fixture startup timed out: ' + errors)), 30000)
    child.once('error', reject); child.once('exit', () => { clearTimeout(timer); reject(new Error('Browser fixture exited: ' + errors)) })
    child.stdout?.on('data', chunk => {
      output += String(chunk)
      for (;;) {
        const end = output.indexOf('\n'); if (end < 0) break
        const line = output.slice(0, end); output = output.slice(end + 1)
        try { const value = JSON.parse(line); if (value.url && value.workspace) { clearTimeout(timer); resolve(value) } } catch {}
      }
    })
  })
})
test.afterAll(async () => {
  if (child && child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await done }
  if (root) await rm(root, { recursive: true, force: true })
})

test('workspace tabs, editing/reload and streaming composer remain stable', async ({ page, context }) => {
  await page.addInitScript(workspaceId => {
    const viewKey = 'hulala.view-id.' + workspaceId
    if (!sessionStorage.getItem(viewKey)) sessionStorage.setItem(viewKey, 'corrupt-view-id')
    Reflect.set(window, '__hulalaMainJournalOpens', 0)
    const open = IDBFactory.prototype.open
    Object.defineProperty(IDBFactory.prototype, 'open', { configurable: true, value: function(this: IDBFactory, name: string, version?: number) {
      if (name.startsWith('hulala.drafts.')) {
        Reflect.set(window, '__hulalaMainJournalOpens', Number(Reflect.get(window, '__hulalaMainJournalOpens')) + 1)
        throw new Error('Draft database must open outside the UI thread')
      }
      return open.call(this, name, version)
    } })
  }, fixture.workspaceId)
  await page.goto(fixture.url)
  await expect(page).toHaveTitle('workspace · Hulala')
  await page.getByText('Browser QA.md', { exact: true }).dblclick()
  const editor = page.locator('.cm-content[contenteditable="true"]')
  await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\n中文 browser save')
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByRole('status').filter({ hasText: 'Saved to file' })).toBeVisible()
  await expect.poll(() => readFile(join(fixture.workspace, 'Browser QA.md'), 'utf8')).toContain('中文 browser save')
  await page.reload(); await expect(editor).toContainText('中文 browser save')
  const newPage = context.waitForEvent('page')
  await page.evaluate(async path => { await window.hulala!.window.createLocal({ path }) }, fixture.second)
  const second = await newPage; await second.waitForLoadState('domcontentloaded'); await expect(second).toHaveTitle('项目 B · Hulala')
  await expect(page).toHaveTitle('workspace · Hulala'); await second.close()
  const settingsPage = context.waitForEvent('page')
  await page.evaluate(async () => { await window.hulala!.harness.settings.openDocument() })
  const settingsDocument = await settingsPage
  await expect(settingsDocument.locator('.cm-content')).toBeVisible()
  await expect(settingsDocument).toHaveTitle(/ · Hulala$/)
  await settingsDocument.close()
  await page.getByRole('button', { name: 'Open chat in workspace', exact: true }).click()
  const input = page.locator('.hulala-composer-input-wrap textarea')
  await expect(input).toBeEnabled()
  await input.fill('Return a short fixture reply.')
  await input.press('Enter')
  await expect(page.getByText('Browser fixture reply.', { exact: false }).first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Unsupported Harness event', { exact: true })).toHaveCount(0)
  const toolbar = page.locator('.hulala-composer-toolbar')
  const before = await toolbar.evaluate(element => {
    const buttons = [...element.querySelectorAll('button')]
    const samples: Array<{ buttons: number; opacity: string; height: number }> = []
    return new Promise(resolve => {
      const timer = setInterval(() => samples.push({ buttons: buttons.filter(button => button.isConnected).length, opacity: getComputedStyle(element).opacity, height: element.getBoundingClientRect().height }), 100)
      setTimeout(() => { clearInterval(timer); resolve({ expected: buttons.length, samples }) }, 5000)
    })
  }) as { expected: number; samples: Array<{ buttons: number; opacity: string; height: number }> }
  expect(before.expected).toBeGreaterThan(0)
  expect(before.samples.every(sample => sample.buttons === before.expected && sample.opacity === '1' && sample.height > 0)).toBe(true)
  expect(await page.evaluate(() => Reflect.get(window, '__hulalaMainJournalOpens'))).toBe(0)
})

test('blocked browser storage preserves drafts and settings dialogs stay usable', async ({ browser }) => {
  const context = await browser.newContext()
  // Hold file saves unavailable so slow browsers cannot auto-save the draft
  // before this recovery test observes it. The Host journal stays reachable.
  const saveRoute = '**/api/files/text'
  await context.route(saveRoute, route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'fixture_save_paused', message: 'File saves are temporarily unavailable in this fixture' }) })
    : route.continue())
  await context.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('Synthetic denied storage', 'SecurityError') } })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: undefined })
    Object.defineProperty(window, 'Worker', { configurable: true, value: undefined })
  })
  const page = await context.newPage()
  try {
    await page.goto(fixture.url)
    await expect(page.getByRole('status').filter({ hasText: 'Browser draft storage is unavailable' })).toBeVisible()
    await page.getByText('Browser QA.md', { exact: true }).dblclick()
    const editor = page.locator('.cm-content[contenteditable="true"]')
    await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\nRecover without browser storage')
    await expect(editor).toContainText('Recover without browser storage')
    await expect(page.getByRole('status').filter({ hasText: /Draft backed up|Save failed — draft retained/ })).toBeVisible()
    await page.evaluate(async () => { await window.hulala!.backup.flush() })
    expect(await readFile(join(fixture.workspace, 'Browser QA.md'), 'utf8')).not.toContain('Recover without browser storage')
    page.on('dialog', dialog => dialog.accept())
    await page.reload(); await expect(editor).toContainText('Recover without browser storage')
    await context.unroute(saveRoute)
    await editor.click(); await page.keyboard.press('ControlOrMeta+s')
    await expect(page.getByRole('status').filter({ hasText: 'Saved to file' })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(settings).toBeVisible()
    await page.route('**/api/browser/dialogs/directory', route => route.fulfill({ json: { path: null } }))
    const folderRequest = page.waitForRequest(request => request.url().endsWith('/api/browser/dialogs/directory') && request.method() === 'POST')
    await settings.getByRole('button', { name: 'Choose Workspace', exact: true }).click()
    await folderRequest
    await expect(page.getByRole('dialog', { name: 'Select directory', exact: true })).not.toBeVisible()
    await expect(settings).toBeVisible()
    await page.setViewportSize({ width: 800, height: 600 })
    const box = await settings.boundingBox(); expect(box!.width).toBeLessThanOrEqual(800)
    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(settings).not.toBeVisible()
  } finally { await context.close() }
})

test('native folder selection opens its reserved tab and cancellation closes the empty tab', async ({ page, context }) => {
  let chosenPath: string | null = fixture.second
  await page.route('**/api/browser/dialogs/directory', route => route.fulfill({ json: { path: chosenPath } }))
  await page.goto(fixture.url)
  await expect(page).toHaveTitle('workspace · Hulala')
  const openMenu = async () => {
    await page.locator('.sidebar-root-header').hover()
    await page.locator('.sidebar-root-header').getByRole('button', { name: 'New tab', exact: true }).click()
  }
  await openMenu()
  const newPage = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Open Folder', exact: true }).click()
  const selected = await newPage
  await expect(selected).toHaveTitle('项目 B · Hulala')
  await expect(page).toHaveTitle('workspace · Hulala')
  await selected.close()
  chosenPath = null
  await openMenu()
  const canceledPage = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Open Folder', exact: true }).click()
  const canceled = await canceledPage
  await expect.poll(() => canceled.isClosed()).toBe(true)
  await expect(page.getByRole('dialog', { name: 'Open Folder', exact: true })).not.toBeVisible()
})

test('the right-side control toggles the pane and preserves its files without a sidebar duplicate', async ({ page }) => {
  await page.goto(fixture.url)
  await expect(page).toHaveTitle('workspace · Hulala')
  await expect(page.locator('.sidebar-activity-rail .right-workspace-toggle')).toHaveCount(0)
  const right = page.locator('section[data-editor-pane="right"]')
  await page.getByRole('button', { name: 'Open right workspace', exact: true }).click()
  await expect(right).toBeVisible()
  await expect(page.locator('.right-workspace-toggle')).toHaveCount(1)
  await right.locator('.editor-tabbar').getByRole('button', { name: 'Close right workspace', exact: true }).click()
  await expect(right).not.toBeVisible()
  await page.getByText('Browser QA.md', { exact: true }).dblclick()
  await expect(page.locator('.op-document-outline-toggle-wrap .right-workspace-toggle')).toBeVisible()
  const mainTab = page.locator('.editor-file-tabbar.is-main .editor-file-tab').filter({ hasText: 'Browser QA.md' })
  await mainTab.click({ button: 'right' })
  await page.getByRole('button', { name: 'Move to Right', exact: true }).click()
  await expect(right.locator('.cm-content')).toContainText('Original content.')
  await right.locator('.editor-tabbar').getByRole('button', { name: 'Close right workspace', exact: true }).click()
  await expect(right).not.toBeVisible()
  await page.getByRole('button', { name: 'Open right workspace', exact: true }).click()
  await expect(right.locator('.cm-content')).toContainText('Original content.')

  await right.locator('.editor-file-tab').filter({ hasText: 'Browser QA.md' }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Move to Main', exact: true }).click()
  await expect(mainTab).toBeVisible()
  await right.locator('.editor-tabbar').getByRole('button', { name: 'Close right workspace', exact: true }).click()
  await expect(right).not.toBeVisible()
  await expect(page.locator('section[data-editor-pane="main"] .cm-content')).toContainText('Original content.')
})
