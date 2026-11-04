/**
 * Boot for the interactive terminal client.
 *
 * One attached Host, one Session at a time. Everything the window *is* lives in
 * `./plugins/` — the terminal, the frame's seats, the Session stream, the right
 * column, the composer, the rail, the overlay stack, the command surface and the
 * input pipeline — each on the one `Context` this module creates.
 *
 * What is left here is the composition root and nothing else: which plugins load
 * in which order, the transport subscription, the update check, and the exit
 * sequence (`shutdown`) that must run before `process.exit` cuts it off.
 *
 * @module hulala-cli/tui/app
 */
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { deleteKittyImage } from '@earendil-works/pi-tui'
import { createInterface } from 'node:readline'
import { VERSION } from '../constants.js'
import type {
  TerminalBackend,
  TerminalQuestionAnswer,
  TerminalSessionEvent,
  TerminalSessionHandlers,
} from './data/remote.js'
import { textOf } from './data/viewModel.js'
import { editorThemeFromTerminal } from './editor/editorTheme.js'
import type { PtyModule } from './editor/pty.js'
import { resolvePaths } from '../paths.js'
import { checkForUpdate, updateNotice, type UpdateInfo } from '../update/check.js'
import { collect, spawnDetached } from '../spawn.js'
import { createTerminalKernel, provideBackend, type TerminalKernel } from './kernel.js'
import { composerPlugin } from './plugins/composer.js'
import { editorPlugin } from './plugins/editor.js'
import { imePlugin } from './plugins/ime.js'
import { layoutPlugin } from './plugins/layout.js'
import { panesPlugin } from './plugins/panes.js'
import { overlaysPlugin } from './plugins/overlays.js'
import { renderPlugin } from './plugins/render.js'
import { sessionPlugin } from './plugins/session.js'
import { updatePlugin } from './plugins/update.js'
import { railPlugin } from './plugins/rail.js'
import { brandBannerImageId } from './view/brandBanner.js'
import { inputPlugin } from './plugins/input.js'
import { lifecyclePlugin } from './plugins/lifecycle.js'
import { commandsPlugin } from './plugins/commands.js'
import { userPluginsPlugin } from './plugins/user.js'
import { viewPlugin } from './plugins/view.js'
import { terminalPlugin } from './plugins/terminal.js'
import { viewModelPlugin } from './plugins/viewModel.js'

export interface RunTerminalOptions {
  backend: TerminalBackend
  cwd: string
  resume?: string
  /**
   * The window's plugin host. The running client boots one (see `cli.ts`),
   * installs the transport on it, and disposes it when the window closes; tests
   * leave it out and this module makes and disposes its own, so both paths
   * publish the same `backend` service to plugins.
   */
  kernel?: TerminalKernel
  input?: NodeJS.ReadableStream & { isTTY?: boolean }
  output?: NodeJS.WritableStream & { isTTY?: boolean }
  /**
   * pty backend for the sidebar columns. The running client resolves the
   * platform module itself; tests inject a fake so no shell or editor starts.
   */
  pty?: PtyModule
  /** Update check for the interactive client; tests inject a fixed result. */
  updateCheck?: () => Promise<UpdateInfo | undefined>
  /** Install a downloaded release; tests inject a fixed result. */
  applyUpdate?: () => Promise<{ ok: boolean; message: string }>
  /** Restart onto the installed release; tests inject a recorder. */
  restartClient?: (resume: string | undefined) => void
}

/**
 * Append one diagnostic line when `HULALA_DEBUG_CLIENT` is set.
 *
 * Logging is best effort by design: the client must never fail a turn because a
 * log directory is read-only.
 * @param message - the line to record.
 */
function debugLog(message: string): void {
  if (process.env.HULALA_DEBUG_CLIENT === undefined) return
  try {
    appendFileSync(join(resolvePaths().data, 'logs', 'tui-debug.log'), `${new Date().toISOString()} ${message}\n`)
  } catch {
    // logging is best effort
  }
}

/** Whether this terminal can take ANSI colour at all. */
function colorEnabled(): boolean {
  return process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb'
}

/** Run `hulala update` the way the shell would and keep its last line. */
async function defaultApplyUpdate(): Promise<{ ok: boolean; message: string }> {
  const entry = process.argv[1]
  if (entry === undefined) return { ok: false, message: 'cannot locate the hulala entry point' }
  const { code, stdout, stderr } = await collect(process.execPath, [entry, 'update'])
  const lines = (stdout + stderr).split('\n').map(line => line.trim()).filter(line => line !== '')
  const tail = lines.slice(-2).join(' · ')
  if (code === 0) return { ok: true, message: tail === '' ? 'release installed' : tail }
  return { ok: false, message: tail === '' ? `hulala update exited with ${code}` : tail }
}

/** Hand the terminal to the newly activated release, resuming this Session. */
function restartClient(dataRoot: string, resume: string | undefined): void {
  const launcher = join(dataRoot, 'bin', 'hulala')
  const args = [launcher, ...(resume === undefined ? [] : ['--resume', resume])]
  try {
    spawnDetached(process.execPath, args, 'inherit')
  } catch {
    // Restarting is a convenience; failing to spawn leaves the new release
    // installed and the user can run `hulala` themselves.
  }
}

function stringAt(value: unknown, ...path: readonly string[]): string | undefined {
  let current = value
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' ? current : undefined
}

/** Whether this window owns its terminal, as opposed to a test injecting streams. */
function ownsTerminal(options: RunTerminalOptions): boolean {
  return options.input === undefined && options.output === undefined
}

/**
 * Run the terminal client until the user detaches.
 * @returns process exit code.
 */
export async function runTerminalClient(options: RunTerminalOptions): Promise<number> {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const interactive = input.isTTY === true && output.isTTY === true
  // One window is one context. A caller that booted one (the real client, so the
  // transport could be installed on it) owns it; otherwise this module does.
  const kernel = options.kernel ?? createTerminalKernel()
  const ctx = kernel.ctx
  provideBackend(ctx, options.backend)
  try {
    await ctx.plugin(lifecyclePlugin)
    await ctx.plugin(viewModelPlugin)
    if (!interactive) {
      return await runPlain({ ...options, kernel }, input, output)
    }
    await ctx.plugin(terminalPlugin, { input, output, composerPaging: true })
    await ctx.plugin(renderPlugin)
    await ctx.plugin(layoutPlugin)
    await ctx.plugin(editorPlugin)
    // The input source is a window-wide fact: the rail and both sidebar columns
    // ask it for English while they own the keyboard, so it loads before them.
    await ctx.plugin(imePlugin, { live: ownsTerminal(options) })
    // Ordered by dependency: each row injects only what a row above it provides,
    // so no plugin spends its first tick pending on a later one.
    await ctx.plugin(overlaysPlugin, { color: colorEnabled(), debug: debugLog })
    await ctx.plugin(composerPlugin, { color: colorEnabled() })
    await ctx.plugin(panesPlugin, { color: colorEnabled(), ...(options.pty === undefined ? {} : { pty: options.pty }), debug: debugLog })
    await ctx.plugin(sessionPlugin, { color: colorEnabled(), cwd: options.cwd })
    await ctx.plugin(railPlugin, { color: colorEnabled(), isClosing: () => ctx.hulalaLifecycle.closing })
    await ctx.plugin(viewPlugin, { color: colorEnabled() })
    await ctx.plugin(commandsPlugin, { color: colorEnabled() })
    await ctx.plugin(inputPlugin, { debug: debugLog })
    await ctx.plugin(updatePlugin, { ...(options.applyUpdate === undefined ? {} : { applyUpdate: options.applyUpdate }) })
    // Last: a user plugin may register into any service above.
    await ctx.plugin(userPluginsPlugin, { dataRoot: resolvePaths().data, debug: debugLog })
    const production = ownsTerminal(options)
    return await runInteractive({ ...options, kernel }, production)
  } finally {
    await kernel.dispose()
  }
}

async function runInteractive(options: RunTerminalOptions, exitProcess: boolean): Promise<number> {
  const backend = options.backend
  const kernel = options.kernel!
  const ctx = kernel.ctx
  const { terminal, screen: ui } = ctx.hulalaTerminal
  const render = ctx.hulalaRender
  const overlays = ctx.hulalaOverlays
  const layout = ctx.hulalaLayout
  const nvim = ctx.hulalaEditor
  const panes = ctx.hulalaPanes
  const session = ctx.hulalaSession
  const updater = ctx.hulalaUpdate
  const composerKit = ctx.hulalaComposer
  const done = Promise.withResolvers<number>()
  const lifecycle = ctx.hulalaLifecycle
  const reducer = ctx.hulalaViewModel.reducer

  let clock: ReturnType<typeof setInterval> | undefined

  const color = colorEnabled()
  const editor = ctx.hulalaComposer.editor
  const commands = ctx.hulalaCommands

  layout.rebuild()
  ui.setFocus(editor)

  // The editor ships with Hulala: bundled binary, vendored plugin, its own
  // config under the state root. Only the theme comes from the terminal. The
  // package is published on first open, so the command is resolved again there.
  const dataRoot = resolvePaths().data
  panes.setComposer(editor)

  const rebuildLayout = (): void => { layout.rebuild() }

  const onWindowResize = (): void => {
    if (layout.paneId !== undefined || layout.railWanted) rebuildLayout()
  }
  // Registered as an effect so a window that ends any way stops listening; the
  // context disposes this before the terminal is handed back.
  ctx.effect(() => {
    process.on('SIGWINCH', onWindowResize)
    return () => process.off('SIGWINCH', onWindowResize)
  }, 'hulala: window resize')

  /**
   * Show the live turn clock while the Session runs, and repaint once a second
   * so its elapsed time advances. Nothing else in the app needs a timer.
   */
  const syncRunning = (): void => {
    if (reducer.busy && clock === undefined) {
      clock = setInterval(() => { render.request() }, 1_000)
    } else if (!reducer.busy && clock !== undefined) {
      clearInterval(clock)
      clock = undefined
    }
  }
  // The window ending is the only thing that stops the turn clock, so it is an
  // effect rather than a line in `shutdown()` — which `process.exit` skips.
  ctx.effect(() => () => {
    if (clock !== undefined) clearInterval(clock)
    clock = undefined
  }, 'hulala: turn clock')

  // The turn clock is the only sync step left here: the transcript, the dock
  // rows and the rail each own theirs now.
  render.onSync(syncRunning)
  const rerender = (): void => { render.repaint() }

  // A swap only happens from the running client, so the exit is always the
  // updater's cue to hand the terminal over.
  ctx.on('hulala/quit', () => { void requestShutdown() })
  ctx.on('hulala/update-installed', () => { void requestShutdown() })

  const shutdown = async (code: number): Promise<void> => {
    if (!lifecycle.beginClose()) return
    // The banner is a terminal image layer, not text, and an image outlives the
    // alternate screen it was painted in: it has to be named for deletion twice,
    // once while the alternate screen still owns it and once after the terminal
    // is back, because a terminal may move images across that switch.
    const logoId = brandBannerImageId()
    if (logoId !== undefined) terminal.write(deleteKittyImage(logoId))
    // Columns are killed here rather than through a normal close: the UI is
    // about to stop, so their exit handlers must not repaint or refocus.
    panes.dispose()
    panes.setDividerHover(false)
    // Leave the alternate screen here rather than waiting for the context's
    // disposer: `/update` hands the terminal to the new client before anything
    // else, so the order is the caller's to decide. `stop()` is idempotent, and
    // the terminal plugin's own effect is the fallback for every other exit.
    ui.stop()
    if (logoId !== undefined) terminal.write(deleteKittyImage(logoId))
    // The terminal is back to its normal buffer by now, so the new client can
    // take it over: that is what makes `/update` feel like a restart rather than
    // "quit and run it again".
    if (updater.restartWanted) {
      const restart = options.restartClient ?? (exitProcess ? (resume: string | undefined) => restartClient(dataRoot, resume) : undefined)
      if (restart !== undefined) restart(session.id)
    }
    // The context owns every plugin, so disposing it is what closes the
    // transport, the ptys and the subscriptions in one place. It has to happen
    // before `process.exit`, which would otherwise cut them off mid-flight.
    await backend.close().catch(() => undefined)
    await kernel.dispose().catch(() => undefined)
    if (exitProcess) {
      // Explicit exit, like pi's interactive mode: the Host connection or a
      // resumed stdin can otherwise keep the event loop alive after the client
      // has restored the terminal.
      process.exit(code)
    } else {
      done.resolve(code)
    }
  }

  /** Quit the client: settle the editor first, then stop. */
  const requestShutdown = async (): Promise<void> => {
    if (lifecycle.closing) return
    if (!await panes.leave()) return
    await shutdown(0)
  }

  /**
   * Run one selector in the composer's place.
   *
   * The panel takes focus and keeps the app's global keys (interrupt, double
   * Esc, pane chords) out of the way until it resolves; the composer comes back
   * in the same tick the selector closes, so the dock never loses its slot.
   * @param build - receives the resolver the selector calls when it is done.
   * @returns the selector's result.
   */
  const composerPanel = ctx.hulalaComposer.panel


  /**
   * Create a Session in the directory the open Session is in.
   *
   * `session.cwd` is the live directory (it follows the open Session), not the launch
   * directory: `/new` after switching to another folder has to land in that
   * folder, and `n` in the rail does the same.
   * @returns the new Session's id.
   */
  // Enter steers a running turn and opens a new one when idle; the queue chord
  // always asks for a follow-up turn, which on an idle Session is the same thing.
  // The rule itself lives in the command plugin.
  editor.onSubmitGesture = (text, gesture): void => {
    editor.addToHistory(text)
    void commands.submit(text, commands.modeFor(gesture))
  }

  // Global keys that pi-tui does not own (Esc, Ctrl-C/D/F/L/O/Q/T/W/]/[).
  // Backend subscriptions.
  backend.onApproval(async request => {
    const outcome = await overlays.showApproval(request)
    if (!lifecycle.closing) {
      reducer.addNotice(`approval ${outcome}`)
      rerender()
    }
    return outcome
  })
  backend.onQuestion(async (questions, signal) => await overlays.handleQuestions(questions, signal))
  // The first frame is the three-column layout: the rail is on by default, so
  // the initial plain build above only holds the slot until this point.
  rebuildLayout()
  ui.setFocus(editor)

  ui.start()

  // The reminder is deliberately off the startup path: a slow or unreachable
  // release index must not delay the first Session, and the client works
  // without it. Tests inject `updateCheck` instead of reaching the network.
  const updateCheck = options.updateCheck
    ?? (exitProcess ? () => checkForUpdate({ currentVersion: VERSION }) : undefined)
  if (updateCheck !== undefined) {
    void updateCheck()
      .then((info) => {
        if (info === undefined || lifecycle.closing) return
        updater.offer(info)
        updater.announce()
      })
      .catch(() => undefined)
  }

  // The editor's colours follow the terminal, so the split has no seam: ask the
  // terminal for its palette and fall back to the built-in one if it stays quiet.
  void ui.queryTerminalColors({ timeoutMs: 300 })
    .then((colors) => {
      nvim.setTheme(editorThemeFromTerminal(colors))
      // The dim cursor follows the resolved foreground/background.
      if (!lifecycle.closing) render.request()
    })
    .catch(() => undefined)

  try {
    await Promise.race([backend.ready(), done.promise])
  } catch (caught) {
    if (!lifecycle.closing) {
      reducer.addNotice(`event connection unavailable: ${caught instanceof Error ? caught.message : String(caught)}`)
      rerender()
    }
  }

  const initial = await session.bootstrap(options.resume, options.cwd)
  if (initial === undefined || lifecycle.closing) {
    await shutdown(0)
    return await done.promise
  }
  // The check may have finished before the first Session existed; the notice is
  // shown now that there is a transcript to show it in.
  updater.announce()
  if (lifecycle.closing) return await done.promise
  return await done.promise
}

/** Non-TTY fallback: line-based input and plain incremental output. */
async function runPlain(
  options: RunTerminalOptions,
  input: NodeJS.ReadableStream & { isTTY?: boolean },
  output: NodeJS.WritableStream & { isTTY?: boolean },
): Promise<number> {
  const backend = options.backend
  const done = Promise.withResolvers<number>()
  const rl = createInterface({ input, output, terminal: false })
  const reducer = options.kernel!.ctx.hulalaViewModel.reducer
  let sessionId: string | undefined
  let closing = false
  const write = (text: string): void => { output.write(`${text}\n`) }

  const renderEvent = (event: TerminalSessionEvent): string | undefined => {
    switch (event.type) {
      case 'user/message': {
        const source = stringAt(event.data, 'source', 'kind')
        if (source !== undefined && source !== 'user') return undefined
        const text = textOf((event.data as { content?: unknown }).content)
        return text.trim() === '' ? undefined : `› ${text}`
      }
      case 'assistant/message': {
        const text = textOf((event.data as { message?: { content?: unknown } }).message?.content)
        return text.trim() === '' ? undefined : text
      }
      case 'compaction/summary': {
        const text = textOf((event.data as { summary?: unknown }).summary)
        return text.trim() === '' ? undefined : `[summary] ${text}`
      }
      case 'tool/call': {
        const name = stringAt(event.data, 'name') ?? 'tool'
        return `⚙ ${name}`
      }
      case 'tool/result': {
        const isError = (event.data as { message?: { isError?: unknown } }).message?.isError === true
        const text = textOf((event.data as { message?: { content?: unknown } }).message?.content)
        return `${isError ? '✗' : '✓'} ${text}`
      }
      case 'turn/end': {
        const kind = stringAt(event.data, 'reason', 'kind')
        if (kind === 'error') return `! ${stringAt(event.data, 'reason', 'error', 'message') ?? 'turn failed'}`
        if (kind === 'aborted') return 'turn cancelled'
        return undefined
      }
      case 'error':
        return `! ${stringAt(event.data, 'message') ?? 'session error'}`
      default:
        return undefined
    }
  }

  const handlers: TerminalSessionHandlers = {
    onEvent: event => {
      reducer.applyEvent(event)
      const text = renderEvent(event)
      if (text !== undefined) write(text)
    },
    onAssistantDelta: text => output.write(text),
    onAssistantEnd: () => output.write('\n'),
    onError: message => write(`! ${message}`),
    onRunning: () => undefined,
  }

  const createNewSession = async (): Promise<string> => {
    const workspaceId = await backend.ensureWorkspace(options.cwd)
    return await backend.createSession(workspaceId)
  }

  const openSession = async (id: string): Promise<void> => {
    sessionId = id
    write(`Session ${id}`)
    backend.follow(id, handlers)
  }

  backend.onApproval(async request => {
    write(`[approval] ${request.toolName}`)
    write('  y = allow once · n = reject · c = cancel')
    const answer = await new Promise<string | undefined>(resolve => { rl.question('> ', line => resolve(line.trim().toLowerCase())) })
    return answer === 'y' ? 'allowed-once' : answer === 'n' ? 'rejected' : 'cancelled'
  })

  backend.onQuestion(async questions => {
    const answers: TerminalQuestionAnswer[] = []
    for (const question of questions) {
      if (question.options !== undefined && question.options.length > 0) {
        write(question.question)
        question.options.forEach((option, index) => write(`  ${index + 1}. ${option.label}`))
        const line = await new Promise<string | undefined>(resolve => rl.question('> ', resolve))
        const index = Number(line)
        const selected = Number.isInteger(index) && index >= 1 && index <= question.options!.length
          ? [question.options[index - 1]!.label]
          : []
        answers.push({ id: question.id, selected })
      } else {
        const line = await new Promise<string | undefined>(resolve => rl.question(`${question.question} > `, resolve))
        answers.push({ id: question.id, selected: [], ...(line === undefined ? {} : { custom: line }) })
      }
    }
    return { answers }
  })

  backend.onSessionStatus(() => undefined)
  backend.onSessionError((_id, message) => write(`! ${message}`))

  const initial = options.resume ?? await createNewSession()
  await openSession(initial)

  rl.on('line', async line => {
    if (closing) return
    const text = line.trim()
    if (text === '') return
    if (text === '/quit' || text === '/exit') {
      closing = true
      rl.close()
      await backend.close().catch(() => undefined)
      done.resolve(0)
      return
    }
    if (text.startsWith('/')) {
      const command = text.slice(1).split(/\s+/u)[0]?.toLowerCase()
      if (command === 'status') {
        write(`session ${sessionId ?? '-'}`)
        write(`cwd     ${options.cwd}`)
      } else if (command === 'help') {
        write('/help /sessions /new /resume /model /rename /cancel /status /clear /quit')
      } else if (command === 'cancel') {
        if (sessionId !== undefined) await backend.cancel(sessionId)
      } else {
        write(`unknown command /${command ?? ''}`)
      }
      return
    }
    // Plain mode has no gesture to read a mode from, so every line queues.
    if (sessionId !== undefined) await backend.prompt(sessionId, line, 'queue')
  })

  rl.on('close', () => {
    if (closing) return
    closing = true
    void backend.close().catch(() => undefined).finally(() => done.resolve(0))
  })

  return await done.promise
}
