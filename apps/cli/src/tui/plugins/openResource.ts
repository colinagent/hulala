/**
 * One link from the conversation, opened where the thing it names lives.
 *
 * The client is two processes: this one, which the reader is looking at, and the
 * Host, which owns the Session, its directory and every file the model touched.
 * They are the same computer when the Host is local and two computers when it is
 * not, and a link in the transcript must behave the same way in both cases. That
 * is the rule this plugin exists to hold: a link is opened through the Host that
 * owns it, never through the machine that happens to be painting the frame.
 *
 * Which means the two kinds of target take two different routes, and the split
 * is the same one `data/resource.ts` makes:
 *
 * - a **URL** is location-independent, so it goes to the browser in front of the
 *   reader. There is no other browser: the far machine has none, and a URL does
 *   not name a file that a machine could differ about.
 * - a **path** is location-bound, so it goes to the Host. The Host resolves it
 *   against the Session's directory, confines it to the workspace, and answers
 *   with the absolute path it found — and that path is what the editor column
 *   opens, because the column's Neovim is a Host program too.
 *
 * Nothing here reads a file. `workspaceFiles` is DeepSeek Harness's own Remote
 * namespace, scoped to the Session, and it is the only thing that may say what
 * exists; the client asking it is the whole resource abstraction, and a local
 * attachment is simply the case where that same question is answered by the same
 * machine.
 *
 * @module hulala-cli/tui/plugins/openResource
 */
import { spawn } from 'node:child_process'
import { platform as hostPlatform } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { classifyResource, hostPath, hostReason } from '../data/resource.js'
import { t } from '../i18n/index.js'

export interface OpenResourcePluginConfig {
  /**
   * Open a URL in the reader's browser.
   *
   * Injected so a test can watch which machine a URL is sent to without
   * starting one — the choice is the contract, not the launch.
   */
  readonly browse?: (url: string) => Promise<boolean>
}

/**
 * The platform's own "open this with the default application" command.
 *
 * Never a shell, and never `cmd /c start` on Windows: `cmd.exe` re-parses `&`,
 * `|` and `^` in the argument before `start` runs, and the target is a link from
 * model output. `rundll32` hands the string to the protocol handler as one argv
 * entry, which is what pi's opener does and for the same reason.
 */
const BROWSERS: Readonly<Record<string, readonly [string, readonly string[]]>> = {
  darwin: ['open', []],
  win32: ['rundll32', ['url.dll,FileProtocolHandler']],
}

/**
 * Start the reader's default browser.
 *
 * The client always runs on the machine the reader is at — the TUI is the window
 * — so this is the right machine even when the Host is not. The launch is
 * detached because the browser outlives the frame that opened it.
 * @param url - a link a browser understands.
 * @returns whether a launcher accepted it; a headless machine answers false.
 */
export function openInBrowser(url: string): Promise<boolean> {
  const [command, args] = BROWSERS[hostPlatform()] ?? ['xdg-open', []]
  return new Promise(resolve => {
    const child = spawn(command, [...args, url], {
      cwd: '/',
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => { resolve(false) })
    child.on('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

/** Listen for one activated link and open what it names. */
export function apply(ctx: Context, config: OpenResourcePluginConfig = {}): void {
  const backend = ctx.backend
  const reducer = ctx.hulalaViewModel.reducer
  const render = ctx.hulalaRender
  const browse = config.browse ?? openInBrowser

  const notice = (message: string): void => {
    reducer.addNotice(message)
    render.repaint()
  }

  /**
   * Resolve one target and hand it to whoever can open it.
   *
   * A URL goes to the browser, a path to the Host and then to the editor column.
   * The two failures worth naming are the ones the user cannot act on without
   * being told: a Host that cannot answer (the file is not there, or the link was
   * never a path), and a browser launch that never happened.
   * @param href - the link's target.
   */
  const run = async (href: string): Promise<void> => {
    const target = classifyResource(href)
    if (target.kind === 'other') {
      // An empty link names nothing and a notice about it would only be noise; a
      // scheme this client has no route for is worth saying out loud.
      if (target.text.trim() !== '') notice(t('notice.openUnavailable', { target: target.text }))
      return
    }
    if (target.kind === 'url') {
      if (!await browse(target.url)) notice(t('notice.browserFailed', { url: target.url }))
      return
    }
    const session = ctx.get('hulalaSession')
    const files = backend.workspaceFiles
    const owner = session?.id
    // No Session means no directory to resolve against and nothing that owns a
    // file; no `workspaceFiles` means a Host older than this client.
    if (files === undefined || owner === undefined) {
      notice(t('notice.openUnavailable', { target: target.path }))
      return
    }
    const home = backend.host.home
    const absolute = hostPath({ cwd: session?.cwd ?? '', ...(home === undefined ? {} : { home }) }, target.path)
    let found: string
    try {
      found = (await files.stat(owner, absolute)).absolutePath
    } catch (caught) {
      notice(t('notice.openFailed', { target: target.path, reason: hostReason(caught) }))
      return
    }
    // The column reports its own refusals — no editor on the Host, a window too
    // narrow to split — so this adds none.
    ctx.get('hulalaPanes')?.openFile(found)
  }

  // Fire-and-forget: a click has nowhere to report to, and every failure is a
  // notice of its own.
  ctx.on('hulala/open-resource', href => { void run(href) })
}

/** Cordis object-form plugin. */
export const openResourcePlugin = {
  name: 'hulala-open-resource',
  inject: ['hulalaViewModel', 'hulalaRender', 'backend'],
  apply,
}
