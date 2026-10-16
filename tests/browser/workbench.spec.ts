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

test('native folder selection creates no tab until a directory is chosen and none on cancel', async ({ page, context }) => {
  let complete!: (path: string | null) => void
  let requests = 0
  await page.route('**/api/browser/dialogs/directory', async route => {
    const path = await new Promise<string | null>(resolve => { complete = resolve; requests++ })
    await route.fulfill({ json: { path } })
  })
  await page.goto(fixture.url)
  await expect(page).toHaveTitle('workspace · Hulala')
  const initialPages = context.pages().length
  let openedPages = 0
  context.on('page', () => { openedPages++ })
  const openMenu = async () => {
    await page.locator('.sidebar-root-header').hover()
    await page.locator('.sidebar-root-header').getByRole('button', { name: 'New tab', exact: true }).click()
  }
  await openMenu()
  await page.getByRole('button', { name: 'Open Folder', exact: true }).click()
  await expect.poll(() => requests).toBe(1)
  expect(context.pages().length).toBe(initialPages)
  expect(openedPages).toBe(0)
  await expect(page).toHaveTitle('workspace · Hulala')
  const newPage = context.waitForEvent('page')
  complete(fixture.second)
  const selected = await newPage
  await expect(selected).toHaveTitle('项目 B · Hulala')
  await expect(page).toHaveTitle('workspace · Hulala')
  await expect(page.locator('.sidebar-root-header .ui-chrome-row-label')).toHaveText('workspace')
  await expect(page.locator('.sidebar-hover-area').getByText('Browser QA.md', { exact: true })).toBeVisible()
  await expect(selected.locator('.sidebar-root-header .ui-chrome-row-label')).toHaveText('项目 B')
  await expect(selected.locator('.sidebar-hover-area').getByText('Second.md', { exact: true })).toBeVisible()
  await selected.close()
  await openMenu()
  await page.getByRole('button', { name: 'Open Folder', exact: true }).click()
  await expect.poll(() => requests).toBe(2)
  expect(context.pages().length).toBe(initialPages)
  const canceled = page.waitForResponse(response => response.url().endsWith('/api/browser/dialogs/directory'))
  complete(null)
  await canceled
  expect(context.pages().length).toBe(initialPages)
  expect(openedPages).toBe(1)
  await expect(page.getByRole('dialog', { name: 'Open Folder', exact: true })).not.toBeVisible()
})

test('a new window choosing another folder leaves the original Workspace isolated', async ({ page, context }) => {
  await page.goto(fixture.url)
  await expect(page).toHaveTitle('workspace · Hulala')
  const originalUrl = page.url()
  await page.getByText('Browser QA.md', { exact: true }).dblclick()
  await expect(page.locator('.cm-content')).toContainText('Original content.')

  const newWindow = context.waitForEvent('page')
  await page.evaluate(async () => { await window.hulala!.window.createNew() })
  const other = await newWindow
  await expect(other).toHaveTitle('Open Workspace · Hulala')
  await other.route('**/api/browser/dialogs/directory', route => route.fulfill({ json: { path: fixture.second } }))
  await other.getByRole('button', { name: 'Open Folder', exact: true }).click()
  await expect(other).toHaveTitle('项目 B · Hulala')
  expect(context.pages()).toHaveLength(2)

  const verify = async () => {
    await expect(page).toHaveURL(originalUrl)
    await expect(page).toHaveTitle('workspace · Hulala')
    await expect(page.locator('.sidebar-root-header .ui-chrome-row-label')).toHaveText('workspace')
    await expect(page.locator('.sidebar-hover-area').getByText('Browser QA.md', { exact: true })).toBeVisible()
    await expect(page.locator('.sidebar-hover-area').getByText('Second.md', { exact: true })).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('Original content.')
    await expect(other.locator('.sidebar-root-header .ui-chrome-row-label')).toHaveText('项目 B')
    await expect(other.locator('.sidebar-hover-area').getByText('Second.md', { exact: true })).toBeVisible()
    await expect(other.locator('.sidebar-hover-area').getByText('Browser QA.md', { exact: true })).toHaveCount(0)
  }
  await verify()
  await other.reload(); await page.reload()
  await verify()
  await other.close()
  await expect(page.locator('.sidebar-root-header .ui-chrome-row-label')).toHaveText('workspace')
})

test('EPUB wheel pagination consumes trackpad motion without scrolling the workbench', async ({ page }) => {
  const errors: string[] = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  let publicationScriptRequests = 0
  await page.route('**/epub-fixture-script.js', route => {
    publicationScriptRequests++
    return route.fulfill({ contentType: 'text/javascript', body: 'parent.__hulalaEpubScriptRan = true' })
  })
  await page.goto(fixture.url)
  await page.getByText('Reader QA.epub', { exact: true }).dblclick()
  const iframe = page.locator('section[data-editor-pane="main"] iframe').first()
  const frame = iframe.contentFrame()
  await expect(frame.getByRole('heading', { name: 'Chapter 1', exact: true })).toBeVisible()
  await expect(frame.locator('#op-book-saved-text-style')).toBeAttached()
  await expect(page.getByText('Loading EPUB...', { exact: true })).not.toBeVisible()
  const originalUrl = page.url()
  const originalHeader = await page.locator('.sidebar-root-header').boundingBox()
  expect(await page.evaluate(() => Reflect.get(window, '__hulalaEpubScriptRan'))).toBeUndefined()
  await expect(frame.locator('script')).toHaveCount(0)

  // All reader code executes in the parent, never in the publication document.
  const consumed = await iframe.evaluate(element => {
    const body = (element as HTMLIFrameElement).contentDocument!.body
    const fire = (input: WheelEventInit) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...input })
      body.dispatchEvent(event)
      return event.defaultPrevented
    }
    return [fire({ deltaY: 0.5 }), fire({ deltaX: 3, deltaY: 3 }), fire({ deltaY: 1, ctrlKey: true }), fire({ deltaY: 1, metaKey: true })]
  })
  expect(consumed).toEqual([true, true, false, false])
  // Allow the reader's initial pagination cooldown to expire before a new gesture.
  await page.waitForTimeout(700)
  await frame.getByRole('heading', { name: 'Chapter 1', exact: true }).hover()
  await page.mouse.wheel(0, 120)
  await expect(frame.getByRole('heading', { name: 'Chapter 2', exact: true })).toBeVisible()
  // Momentum during the page-turn cooldown still belongs to the reader.
  expect(await iframe.evaluate(element => {
    const body = (element as HTMLIFrameElement).contentDocument!.body
    const event = new WheelEvent('wheel', { deltaY: 2, bubbles: true, cancelable: true })
    body.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(true)
  await frame.getByRole('link', { name: 'Footnote test', exact: true }).click()
  const footnote = frame.getByRole('dialog', { name: 'Footnote', exact: true })
  await expect(footnote).toBeVisible()
  await footnote.locator('.op-book-epub-footnote-content').hover()
  await page.mouse.wheel(0, 120)
  await expect.poll(() => footnote.locator('.op-book-epub-footnote-content').evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  await expect(frame.getByRole('heading', { name: 'Chapter 2', exact: true })).toBeVisible()
  await footnote.getByRole('button', { name: 'Close footnote', exact: true }).click()
  expect(await page.getByRole('button', { name: 'Next page', exact: true }).evaluate(button => {
    const event = new WheelEvent('wheel', { deltaY: 0.5, bubbles: true, cancelable: true })
    button.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(true)
  await page.waitForTimeout(700)
  await frame.getByRole('heading', { name: 'Chapter 2', exact: true }).hover()
  await page.mouse.wheel(120, 0)
  await expect(frame.getByRole('heading', { name: 'Chapter 3', exact: true })).toBeVisible()
  await expect(page).toHaveURL(originalUrl)
  expect(await page.locator('.sidebar-root-header').boundingBox()).toEqual(originalHeader)
  expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0])
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).overscrollBehavior)).toBe('none')
  expect(await frame.locator('html').evaluate(el => getComputedStyle(el).overscrollBehavior)).toBe('none')
  // The Safari event workaround must not enable scripts from an EPUB, including
  // scripts/inline handlers inserted after the original document was sanitized.
  await iframe.evaluate(element => {
    const doc = (element as HTMLIFrameElement).contentDocument!
    const script = doc.createElement('script')
    script.textContent = 'parent.__hulalaEpubScriptRan = true'
    doc.body.append(script)
    const button = doc.createElement('button')
    button.setAttribute('onclick', 'parent.__hulalaEpubScriptRan = true')
    doc.body.append(button)
    button.click()
  })
  expect(await page.evaluate(() => Reflect.get(window, '__hulalaEpubScriptRan'))).toBeUndefined()
  expect(publicationScriptRequests).toBe(0)
  expect(errors.filter(error => /passive|preventDefault/i.test(error))).toEqual([])
})

test('the right-side control preserves visibility and files across reloads without a sidebar duplicate', async ({ page, context }) => {
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
  await expect(page.locator('.editor-file-tabbar.is-main').getByRole('button', { name: 'Open right workspace', exact: true })).toBeVisible()
  await expect(page.locator('.op-document-outline-toggle-wrap .right-workspace-toggle')).toHaveCount(0)
  const mainTab = page.locator('.editor-file-tabbar.is-main .editor-file-tab').filter({ hasText: 'Browser QA.md' })
  await mainTab.click({ button: 'right' })
  await page.getByRole('button', { name: 'Move to Right', exact: true }).click()
  await expect(right.locator('.cm-content')).toContainText('Original content.')
  await right.locator('.editor-tabbar').getByRole('button', { name: 'Close right workspace', exact: true }).click()
  await expect(right).not.toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Open right workspace', exact: true })).toBeVisible()
  await expect(right).not.toBeVisible()
  await page.getByRole('button', { name: 'Open right workspace', exact: true }).click()
  await expect(right.locator('.cm-content')).toContainText('Original content.')
  await page.reload()
  await expect(right.locator('.cm-content')).toContainText('Original content.')

  // Even two browser tabs on the same Workspace keep independent pane layouts.
  const sibling = await context.newPage()
  await sibling.goto(page.url())
  await expect(sibling).toHaveTitle('workspace · Hulala')
  await expect(sibling.locator('section[data-editor-pane="right"]')).not.toBeVisible()
  await sibling.getByRole('button', { name: 'Open right workspace', exact: true }).click()
  await right.getByRole('button', { name: 'Close right workspace', exact: true }).click()
  await page.reload(); await sibling.reload()
  await expect(page.getByRole('button', { name: 'Open right workspace', exact: true })).toBeVisible()
  await expect(right).not.toBeVisible()
  await expect(sibling.locator('section[data-editor-pane="right"]')).toBeVisible()
  await sibling.close()
  await page.getByRole('button', { name: 'Open right workspace', exact: true }).click()
  await expect(right.locator('.cm-content')).toContainText('Original content.')

  await right.locator('.editor-file-tab').filter({ hasText: 'Browser QA.md' }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Move to Main', exact: true }).click()
  await expect(mainTab).toBeVisible()
  await right.locator('.editor-tabbar').getByRole('button', { name: 'Close right workspace', exact: true }).click()
  await expect(right).not.toBeVisible()
  await expect(page.locator('section[data-editor-pane="main"] .cm-content')).toContainText('Original content.')
})
