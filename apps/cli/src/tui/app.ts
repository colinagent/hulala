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
import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deleteKittyImage } from '@earendil-works/pi-tui'
import { FOCUS_OFF, MOTION_OFF } from './terminal/modes.js'
import { createInterface } from 'node:readline'
import { VERSION } from '../constants.js'
import type {
  TerminalBackend,
  TerminalQuestionAnswer,
  TerminalSessionEvent,
  TerminalSessionHandlers,
} from './data/remote.js'
import { textOf } from './data/viewModel.js'
import { editorThemeFromTerminal } from '@hulala/editor-home'
import { FULL_ACCESS_PRESET, permissionLabel } from './view/permission.js'
import type { PtyModule } from './editor/pty.js'
import { resolvePaths } from '../paths.js'
import type { MachineIdentity } from '../machine.js'
import {
  guessLanguage,
  resolveLanguage,
  type ResolvedLanguage,
} from '../language.js'
import { isCommandLine } from './commandCatalog.js'
import { languageProblemText, setActiveLanguage, t } from './i18n/index.js'
import { languagePlugin } from './plugins/language.js'
import { checkForUpdate, type UpdateInfo } from '../update/check.js'
import { collect, handoffInvocation, spawnHandoff } from '../spawn.js'
import { createTerminalKernel, provideBackend, type TerminalKernel } from './kernel.js'
import { composerPlugin } from './plugins/composer.js'
import { editorPlugin } from './plugins/editor.js'
import { inputSourceAllowed } from './editor/inputSourcePolicy.js'
import { focusPlugin } from './plugins/focus.js'
import { imePlugin } from './plugins/ime.js'
import { keymapPlugin } from './plugins/keymap.js'
import { layoutPlugin } from './plugins/layout.js'
import { panesPlugin } from './plugins/panes.js'
import { overlaysPlugin } from './plugins/overlays.js'
import { renderPlugin } from './plugins/render.js'
import { sessionPlugin } from './plugins/session.js'
import { titlePlugin } from './plugins/title.js'
import { updatePlugin } from './plugins/update.js'
import type { Forward } from '../remote/forward.js'
import { remotePlugin } from './plugins/remote.js'
import { railPlugin } from './plugins/rail.js'
import { brandBannerImageId } from './view/brandBanner.js'
import { setTerminalPage } from './view/theme.js'
import { inputPlugin } from './plugins/input.js'
import { lifecyclePlugin } from './plugins/lifecycle.js'
import { commandsPlugin } from './plugins/commands.js'
import { changelogPlugin } from './plugins/changelog.js'
import { startupPlugin } from './plugins/startup.js'
import { viewPlugin } from './plugins/view.js'
import { terminalPlugin } from './plugins/terminal.js'
import { viewModelPlugin } from './plugins/viewModel.js'
import { interactionsPlugin } from './plugins/interactions.js'
import { openResourcePlugin } from './plugins/openResource.js'

export interface RunTerminalOptions {
  backend: TerminalBackend
  cwd: string
  resume?: string
  /**
   * How long an incomplete input sequence waits before it is taken as keys.
   *
   * The terminal's `ttimeoutlen`, and the one timing a test shortens: a suite
   * that waited a tenth of a second for every Escape would spend minutes doing
   * it.
   */
  escapeTimeoutMs?: number
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
  restartClient?: (resume: string | undefined) => void | Promise<void>
  /**
   * The ssh destination this window attached through, when the Host is remote.
   *
   * It rides the restart so the new process rebuilds the same tunnel and attaches
   * to the same machine; losing it would silently drop the window back to local.
   */
  remote?: string
  /**
   * The machine the window title names, when a test needs it fixed.
   *
   * The running client reads the account and the machine name from this process
   * or from the ssh configuration it attached through; a title assertion must not
   * depend on the machine running the test.
   */
  machine?: MachineIdentity
  /**
   * The forward carrying a remote attachment, when there is one.
   *
   * Recovery has to know *why* the event connection is gone: a forward that is
   * being rebuilt heals on its own on the same port, while a forward that answers
   * while this process cannot attach means the Host is another daemon now, which
   * only a new process can reach.
   */
  forward?: Forward
  /** Inject the resolved language; tests use this instead of touching `HULALA_LANG`. */
  language?: ResolvedLanguage
  /** Override the first-use prompt default (on only when this process owns the terminal). */
  promptLanguage?: boolean
  /**
   * Copy a drag selection to the clipboard; tests record it instead.
   *
   * The running client reaches whichever clipboard the user can paste from (see
   * `tui/clipboard.ts`), and injecting this keeps a test from spawning a
   * clipboard tool or writing to the developer's own clipboard.
   */
  copySelection?: (text: string) => Promise<boolean | string>
  /**
   * Open one URL in the reader's browser; tests record it instead.
   *
   * A URL is the one kind of link that is opened by the machine the client runs
   * on rather than by the Host, so injecting this keeps a suite from starting a
   * browser on the machine running the tests.
   */
  browse?: (url: string) => Promise<boolean>
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
    const file = join(resolvePaths().data, 'logs', 'tui-debug.log')
    // Input tracing writes every read and every piece, which a moving pointer
    // makes thousands of lines a second. One cap keeps a repro from filling the
    // disk: the file is restarted once, so the newest run is always the one that
    // survives.
    debugLines += 1
    if (debugLines % 2048 === 0) {
      try {
        if (statSync(file).size > 8 * 1024 * 1024) writeFileSync(file, '')
      } catch {
        // the file does not exist yet, or cannot be restarted
      }
    }
    // A handoff leaves the parent alive while the successor owns the terminal,
    // so every line names its writer: two pids in one trace is a different bug
    // from one pid whose frame went wrong.
    appendFileSync(file, `${new Date().toISOString()} pid=${String(process.pid)} ${message}\n`)
  } catch {
    // logging is best effort
  }
}

/** Lines written this process, for the size check above. */
let debugLines = 0

/** How often the wake probe reads the wall clock. */
const WAKE_PROBE_MS = 1_000

/**
 * A wall clock that jumped this far means the machine slept.
 *
 * macOS suspends the whole machine, not the process, so no `SIGCONT` arrives and
 * no timer fires: the first evidence of a wake is the gap itself. Thirty seconds
 * is far longer than any GC pause or blocked write, and far shorter than the
 * shortest sleep a laptop lid produces.
 */
const SLEEP_JUMP_MS = 30_000

/** Whether this terminal can take ANSI colour at all. */
function colorEnabled(): boolean {
  return process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb'
}

/** Run `hulala update` the way the shell would and keep its last line. */
async function defaultApplyUpdate(): Promise<{ ok: boolean; message: string }> {
  const entry = process.argv[1]
  if (entry === undefined) return { ok: false, message: t('update.entryMissing') }
  const { code, stdout, stderr } = await collect(process.execPath, [entry, 'update'])
  const lines = (stdout + stderr).split('\n').map(line => line.trim()).filter(line => line !== '')
  const tail = lines.slice(-2).join(' · ')
  if (code === 0) return { ok: true, message: tail === '' ? t('update.installed') : tail }
  return { ok: false, message: tail === '' ? t('update.exitCode', { code }) : tail }
}

/**
 * Hand the terminal to a new client process, resuming this Session on the same
 * machine or another one.
 *
 * An installed client starts its launcher. A source checkout must not: `bin/hulala`
 * belongs to the release installed beside it, and starting that instead of the
 * code being edited would be a surprise. A checkout therefore re-runs the entry it
 * is already running — the bundle `bun run start` built — which is the same
 * process with different arguments, exactly what `/update` already does.
 *
 * The successor is started as a **child of this process, in this process's
 * group, and awaited here**. A detached child would leave the tty's foreground
 * process group; the shell would come back and read the same bytes, which is how
 * a `/remote` switch used to split every arrow key and leave terminal replies as
 * `command not found` in the shell.
 */
async function restartClient(dataRoot: string, resume: string | undefined, remote?: string): Promise<void> {
  const tail = [
    ...(resume === undefined ? [] : ['--resume', resume]),
    ...(remote === undefined ? [] : ['--remote', remote]),
  ]
  const invocation = handoffInvocation({
    installed: (process.env.HULALA_INSTALL_ROOT ?? '').trim() !== '',
    dataRoot,
    entry: process.argv[1],
    execPath: process.execPath,
    tail,
  })
  if (invocation === undefined) return
  // A failed spawn resolves instead of throwing: restarting is a convenience,
  // and the user can always run their own entry again.
  await spawnHandoff(invocation.command, invocation.args)
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
  const dataRoot = resolvePaths().data
  const production = ownsTerminal(options)
  const language = options.language ?? resolveLanguage(process.env, dataRoot)
  setActiveLanguage(language.code)
  try {
    await ctx.plugin(lifecyclePlugin)
    await ctx.plugin(viewModelPlugin)
    if (!interactive) {
      return await runPlain({ ...options, kernel }, input, output, language)
    }
    await ctx.plugin(terminalPlugin, {
      input,
      output,
      composerPaging: true,
      debug: debugLog,
      ...(options.escapeTimeoutMs === undefined ? {} : { escapeTimeoutMs: options.escapeTimeoutMs }),
      ...(options.copySelection === undefined ? {} : { copySelection: options.copySelection }),
    })
    await ctx.plugin(renderPlugin, { debug: debugLog })
    // Before anything that reads a chord or prints one: the composer's menu, the
    // input pipeline, `/keys` and the startup hints all read the active keymap.
    await ctx.plugin(keymapPlugin, { dataRoot })
    await ctx.plugin(layoutPlugin, { color: colorEnabled() })
    await ctx.plugin(editorPlugin)
    // The input source is a window-wide fact: the rail and both sidebar columns
    // ask it for English while they own the keyboard, so it loads before them.
    // Selecting a system source is machine-wide, so an injected-stream window and
    // an automated one (a temporary state root, where the end-to-end suites run a
    // real client on a pty) are both excluded: a test must not change the
    // developer's keyboard.
    await ctx.plugin(imePlugin, {
      live: ownsTerminal(options) && inputSourceAllowed({ dataRoot }),
    })
    // Ordered by dependency: each row injects only what a row above it provides,
    // so no plugin spends its first tick pending on a later one.
    await ctx.plugin(overlaysPlugin, { color: colorEnabled(), debug: debugLog })
    // Before anything that reads `t()` or serves `/language`; the picker waits
    // for the first frame, never for the Host or a Session.
    await ctx.plugin(languagePlugin, {
      dataRoot,
      resolved: language,
      color: colorEnabled(),
      prompt: options.promptLanguage ?? ownsTerminal(options),
      guess: guessLanguage(process.env),
    })
    await ctx.plugin(composerPlugin, { color: colorEnabled() })
    await ctx.plugin(panesPlugin, { color: colorEnabled(), ...(options.pty === undefined ? {} : { pty: options.pty }), debug: debugLog })
    // A click on a link is a resource question — Host path or browser URL — so it
    // loads before the frame that can carry one. It reads the Session and the
    // panes lazily: a link is only ever opened once both exist.
    await ctx.plugin(openResourcePlugin, {
      ...(options.browse === undefined ? {} : { browse: options.browse }),
    })
    await ctx.plugin(sessionPlugin, {
      color: colorEnabled(),
      cwd: options.cwd,
      ...(options.remote === undefined ? {} : { remote: true }),
    })
    // Immediately after the Session: the window label is derived from it, and a
    // tab that names its directory from the first frame is what identifies the
    // window among shells and other Sessions.
    await ctx.plugin(titlePlugin, {
      ...(options.remote === undefined ? {} : { remote: options.remote }),
      ...(options.machine === undefined ? {} : { machine: options.machine }),
    })
    // Approvals and user questions are Session state, not window callbacks:
    // install the shared pending-interaction queue before the rail and footer
    // that render it, and long before the first frame. `runInteractive` arms it
    // once the terminal can paint a dialog.
    await ctx.plugin(interactionsPlugin, { backend: options.backend })
    await ctx.plugin(railPlugin, { color: colorEnabled(), isClosing: () => ctx.hulalaLifecycle.closing })
    // After the three panels it arbitrates. A click reaches it only once the
    // frame is on screen, so it reads the panels' services lazily.
    await ctx.plugin(focusPlugin)
    await ctx.plugin(viewPlugin, { color: colorEnabled() })
    // After the view it fills: the welcome block's facts belong to the open
    // Session, so this has to run once there is one, not once the frame exists.
    await ctx.plugin(startupPlugin)
    // Before the command surface: `/changelog` reads the service it provides.
    await ctx.plugin(changelogPlugin, { dataRoot })
    await ctx.plugin(commandsPlugin, { color: colorEnabled() })
    await ctx.plugin(inputPlugin, { debug: debugLog })
    const applyUpdate = options.applyUpdate ?? (production ? defaultApplyUpdate : undefined)
    await ctx.plugin(remotePlugin, {
      color: colorEnabled(),
      ...(options.remote === undefined ? {} : { current: options.remote }),
    })
    await ctx.plugin(updatePlugin, {
      color: colorEnabled(),
      dataRoot,
      ...(applyUpdate === undefined ? {} : { applyUpdate }),
      ...(options.remote === undefined ? {} : { remote: options.remote }),
      ...(options.forward === undefined ? {} : { forward: options.forward }),
    })
    // Last: a user plugin may register into any service above.
    return await runInteractive({ ...options, kernel }, production)
  } finally {
    await kernel.dispose()
  }
}

async function runInteractive(options: RunTerminalOptions, exitProcess: boolean): Promise<number> {
  const backend = options.backend
  const kernel = options.kernel!
  const ctx = kernel.ctx
  const { terminal, screen: ui, focus: focusOn } = ctx.hulalaTerminal
  const render = ctx.hulalaRender
  const overlays = ctx.hulalaOverlays
  const layout = ctx.hulalaLayout
  const nvim = ctx.hulalaEditor
  const panes = ctx.hulalaPanes
  const session = ctx.hulalaSession
  const updater = ctx.hulalaUpdate
  const changelog = ctx.hulalaChangelog
  const composerKit = ctx.hulalaComposer
  const done = Promise.withResolvers<number>()
  const lifecycle = ctx.hulalaLifecycle
  const reducer = ctx.hulalaViewModel.reducer

  let clock: ReturnType<typeof setInterval> | undefined

  const color = colorEnabled()
  const editor = ctx.hulalaComposer.editor
  const commands = ctx.hulalaCommands

  layout.rebuild()
  focusOn(editor)

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
  // updater's cue to hand the terminal over. An update ends the turn either way,
  // so it writes what the editor can write and leaves instead of asking about the
  // buffers it cannot: a question there would strand the window the swap was
  // asked from. `/quit` keeps the question.
  ctx.on('hulala/quit', () => { void requestShutdown() })
  ctx.on('hulala/hangup', () => { void requestShutdown({ force: true }) })
  ctx.on('hulala/update-installed', () => { void requestShutdown({ force: true }) })
  // A frame the queue discarded leaves the renderer counting content the terminal
  // never received. `reconcile` throws that copy away, so the next frame is every
  // row — the only way to repair a cell the diff would otherwise skip. The reason
  // travels with it (`cap`, `error`, `geometry`) into the debug trace.
  ctx.on('hulala/output-lost', reason => { render.reconcile(reason) })

  /**
   * Come back from an interruption that can invalidate the terminal's stream.
   *
   * A machine that slept or a transport that was rebuilt leaves two things the
   * frame cannot see. The first is half a sequence that will never finish: it is
   * dropped rather than drained, because draining hands it back as keys —
   * `[<35;` typed into whatever has the keyboard. The second is a screen the
   * terminal may have reflowed, scrolled or written over while nobody owned it;
   * a differential repaint keeps every cell it believes is unchanged, so the
   * frame is rebuilt from scratch instead.
   * @param reason - what interrupted the stream, for the debug trace.
   * @param why - the reconcile reason: a rebuilt transport or a suspended machine.
   */
  const recoverTerminal = (reason: string, why: 'reconnect' | 'wake'): void => {
    terminal.resetInput(reason)
    render.reconcile(why)
  }

  // A rebuilt transport is the client's own signal that it was away: the Host
  // may have been replaced, the ssh forward may have died, and either way the
  // window has to prove its state again. The first open of a window is not a
  // recovery, so the drop is what arms it.
  let transportLost = false
  ctx.on('hulala/session-disconnected', () => { transportLost = true })
  ctx.on('hulala/session-opened', () => {
    if (!transportLost) return
    transportLost = false
    recoverTerminal('reconnected', 'reconnect')
  })

  // Sleeping leaves no signal of its own, and a terminal that was suspended with
  // a stalled write is the one case where recovery has to happen without the
  // Host noticing anything.
  ctx.effect(() => {
    let last = Date.now()
    const timer = setInterval(() => {
      const now = Date.now()
      const jumped = now - last
      last = now
      if (jumped > SLEEP_JUMP_MS) recoverTerminal(`slept ${String(Math.round(jumped / 1_000))}s`, 'wake')
    }, WAKE_PROBE_MS)
    timer.unref?.()
    return () => { clearInterval(timer) }
  }, 'hulala: wake probe')

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
    // disposer, so the terminal is back in its normal buffer before anything
    // else runs. `stop()` is idempotent, and the terminal plugin's own effect
    // is the fallback for every other exit.
    ui.stop()
    if (logoId !== undefined) terminal.write(deleteKittyImage(logoId))
    // The frame is on the screen, not in the queue: a successor process inherits
    // this terminal, and a frame still waiting here would be painted over it.
    // Bounded, because a terminal that stopped reading must not hold the window
    // open — the exit path flushes what it can and gives up.
    await terminal.drainOutput()
    // The context owns every plugin, so disposing it is what closes the
    // transport, the ptys and the subscriptions in one place. It has to happen
    // before `process.exit`, which would otherwise cut them off mid-flight —
    // and, critically, before the successor starts. A closing transport can
    // still publish a notice (a repaint), and a repaint from this process would
    // land on the new client's frame. Two writers on one tty are the same bug
    // as two readers.
    await backend.close().catch(() => undefined)
    await kernel.dispose().catch(() => undefined)
    // Only now may the successor take the terminal. It is a child of this
    // process in the same foreground process group, and this process waits for
    // it, so the shell never regains the tty between the two windows.
    if (updater.restartWanted) {
      // A window that switched Host decided the destination; otherwise the one
      // this process attached with is carried forward unchanged.
      const destination = updater.nextRemote === undefined
        ? options.remote
        : updater.nextRemote === null ? undefined : updater.nextRemote
      const restart = options.restartClient
        ?? (exitProcess ? (resume: string | undefined) => restartClient(dataRoot, resume, destination) : undefined)
      // A Session belongs to its Host: on a switch the id names a conversation
      // the destination has never had, so the successor starts a new one there.
      // A plain `/update` restart is the same attachment and keeps the Session.
      if (restart !== undefined) await restart(updater.nextRemote === undefined ? session.id : undefined)
    }
    if (exitProcess) {
      // Explicit exit, like pi's interactive mode: the Host connection or a
      // resumed stdin can otherwise keep the event loop alive after the client
      // has restored the terminal.
      process.exit(code)
    } else {
      done.resolve(code)
    }
  }

  /**
   * Quit the client: settle the editor first, then stop.
   * @param options - `force` writes what the editor can write and does not wait
   *   on the confirmation for the buffers it cannot; a swap cannot be refused.
   */
  const requestShutdown = async (options: { force?: boolean } = {}): Promise<void> => {
    if (lifecycle.closing) return
    if (options.force === true) await panes.saveAll()
    else if (!await panes.leave()) return
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

  // Global keys that pi-tui does not own; every one of them is an action in
  // `config/keybindings.json` (see `src/keymap.ts`).
  // Both scoped waterfalls (approvals and user questions) are subscribed by the
  // pending-interactions plugin: installed with the plugins, not here, so a
  // request that lands during boot is parked instead of being answered
  // `next()` by the Gateway. This window only tells the queue when it is safe
  // to put a dialog on the frame.
  // The first frame is the three-column layout: the rail is on by default, so
  // the initial plain build above only holds the slot until this point.
  rebuildLayout()
  focusOn(editor)

  // All-motion tracking makes every pointer movement a report; this client only
  // uses bare motion for a divider's pointer shape. Button motion keeps clicks,
  // drags, selection and the wheel — and a trackpad stops flooding the input.
  // The adapter also filters the enable sequence, so this clears any state a
  // previous program left behind.
  //
  // It has to be written *before* `ui.start()`, never after: resetting any one
  // of the mouse-reporting modes turns the whole group off on a terminal that
  // keeps them in one flag (Ghostty: `?1003l` sets `mouse_event = .none`, it
  // does not stop at "any-motion"). Written after the renderer's enable it
  // would switch the just-enabled button tracking off again, and a trackpad
  // would then scroll the alternate screen as Up/Down keys — which is history
  // recall in the composer, not a moving transcript.
  terminal.write(MOTION_OFF)
  // Focus reports (`ESC [ I`, `ESC [ O`) fire whenever the window's focus
  // changes — a screenshot, a click elsewhere — and each one is another sequence
  // that can be split and typed. pi-tui uses `ESC[O` to drop a drag in progress,
  // but with bare motion off that is a smaller loss than the garbage is.
  terminal.write(FOCUS_OFF)
  ui.start()
  ctx.hulalaInteractions.arm()
  // The language picker (when the language is unset) is a first-frame surface:
  // emitting after `start()` keeps attach and Session boot off its path.
  setImmediate(() => { if (!lifecycle.closing) ctx.emit('hulala/first-frame') })

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
  // The same answer places the tool card a step above the page it is drawn on,
  // and draws the archived prompt as the editor's `##` heading band, in that
  // heading's own yellow ink.
  void ui.queryTerminalColors({ timeoutMs: 300 })
    .then((colors) => {
      nvim.setTheme(editorThemeFromTerminal(colors))
      setTerminalPage(colors)
      // The dim cursor and the card surface follow the resolved palette.
      if (!lifecycle.closing) render.request()
    })
    .catch(() => undefined)

  try {
    await Promise.race([backend.ready(), done.promise])
  } catch (caught) {
    if (!lifecycle.closing) {
      reducer.addNotice(t('notice.connectionUnavailable', { reason: caught instanceof Error ? caught.message : String(caught) }))
      rerender()
    }
  }

  // Only an explicit `--resume` continues a Session: it comes from the command
  // line or from a restart that knows which one this window was showing. A plain
  // launch always starts a new Session in the directory it was run from — one
  // directory, one fresh conversation — and `/sessions` or `/resume` is how a
  // previous one is reopened.
  // A Host that cannot create a Workspace (a path that only exists on this
  // machine, a directory that vanished) is a message, not a reason to close the
  // window: the frame stays usable and `/new` retries.
  let initial: string | undefined
  try {
    initial = await session.bootstrap(options.resume, options.cwd)
  } catch (error) {
    reducer.addNotice(t('notice.sessionUnavailable', {
      reason: error instanceof Error ? error.message : String(error),
    }))
    rerender()
  }
  if (lifecycle.closing) return await done.promise
  // The check may have finished before the first Session existed; the notice is
  // shown now that there is a transcript to show it in.
  updater.announce()
  // Same reason as the update notice: the changelog block needs a transcript,
  // and it is spent once per state root and version. A window this process does
  // not own (a test harness, a piped run) keeps its transcript clean.
  if (exitProcess) changelog.announce()
  if (lifecycle.closing) return await done.promise
  return await done.promise
}

/** Non-TTY fallback: line-based input and plain incremental output. */
async function runPlain(
  options: RunTerminalOptions,
  input: NodeJS.ReadableStream & { isTTY?: boolean },
  output: NodeJS.WritableStream & { isTTY?: boolean },
  language: ResolvedLanguage,
): Promise<number> {
  const backend = options.backend
  const done = Promise.withResolvers<number>()
  const rl = createInterface({ input, output, terminal: false })
  const reducer = options.kernel!.ctx.hulalaViewModel.reducer
  let sessionId: string | undefined
  let closing = false
  const write = (text: string): void => { output.write(`${text}\n`) }
  if (language.problem !== undefined) write(`! ${languageProblemText(language.problem)}`)

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
        return text.trim() === '' ? undefined : `${t('plain.summary')} ${text}`
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
        if (kind === 'error') return `! ${stringAt(event.data, 'reason', 'error', 'message') ?? t('plain.turnFailed')}`
        if (kind === 'aborted') return t('plain.turnCancelled')
        return undefined
      }
      case 'error':
        return `! ${stringAt(event.data, 'message') ?? t('plain.sessionError')}`
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
    // A remote Host has no reason to have this machine's directory: ask the Host
    // for its own default Workspace instead. Locally the launch directory is the
    // right answer and the Workspace is created around it.
    if (options.remote !== undefined) {
      const fallback = await backend.defaultWorkspace()
      if (fallback !== undefined) return await backend.createSession(fallback.id)
    }
    const workspaceId = await backend.ensureWorkspace(options.cwd)
    return await backend.createSession(workspaceId)
  }

  const openSession = async (id: string): Promise<void> => {
    sessionId = id
    write(t('plain.session', { id }))
    backend.follow(id, handlers)
  }

  backend.onApproval(async request => {
    // A line-based client has no rail to switch Sessions with, so it answers
    // whatever the Host asks — but it must still name the owner: granting Full
    // access to the window's Session for a background request would widen the
    // wrong thread.
    const owner = request.sessionId ?? sessionId
    if (request.sessionId !== undefined && request.sessionId !== sessionId) {
      write(t('plain.approvalOtherSession', { session: request.sessionId }))
    }
    write(t('plain.approval', { tool: request.toolName }))
    write(t('plain.approvalHint'))
    const answer = await new Promise<string | undefined>(resolve => { rl.question('> ', line => resolve(line.trim().toLowerCase())) })
    if (answer === 'd') {
      write(t('notice.approvalDelegated', { tool: request.toolName, session: request.sessionId ?? t('notice.approvalThisSession') }))
      return 'delegate'
    }
    if (answer === 'f') {
      if (owner === undefined) write(`! ${t('notice.approvalFullAccessUnavailable')}`)
      else {
        try {
          await backend.setPermission(owner, FULL_ACCESS_PRESET)
          write(t('notice.approvalFullAccess', { preset: permissionLabel(FULL_ACCESS_PRESET) }))
        } catch (caught) {
          write(`! ${t('notice.approvalFullAccessFailed', { reason: caught instanceof Error ? caught.message : String(caught) })}`)
        }
      }
      return 'allowed-once'
    }
    return answer === 'y' ? 'allowed-once' : answer === 'n' ? 'rejected' : 'cancelled'
  })

  // A line-based client has no rail to switch Sessions with, so it answers
  // questions as they arrive. The scoped owner is still available on the
  // request for callers that need it; this path just has no queue to park in.
  /**
   * Read one answer line, resolving `undefined` when the input closes instead
   * of leaving `rl.question` pending forever.
   */
  const readAnswer = (prompt: string): Promise<string | undefined> => new Promise(resolve => {
    let settled = false
    const finish = (value: string | undefined): void => {
      if (settled) return
      settled = true
      rl.off('close', onClose)
      resolve(value)
    }
    const onClose = (): void => finish(undefined)
    rl.once('close', onClose)
    rl.question(prompt, line => finish(line.trim()))
  })

  backend.onQuestion(async request => {
    const answers: TerminalQuestionAnswer[] = []
    for (const question of request.questions) {
      const options = question.options ?? []
      if (options.length > 0) {
        write(question.question)
        options.forEach((option, index) => write(`  ${index + 1}. ${option.label}`))
        write(t('plain.questionPrompt'))
      }
      // DSH's Web composer will not submit an unanswered question: it asks
      // again or takes an explicit skip. A line client has no skip button, so
      // an empty line re-prompts instead of encoding `selected: []`, which the
      // answer schema accepts but the caller never asked for. EOF dismisses.
      let line: string | undefined
      do {
        line = await readAnswer(options.length > 0 ? '> ' : `${question.question} > `)
        if (line === undefined) return { rejected: 'ASK_CANCELLED' }
        if (line === '') write(t('plain.questionRequired'))
      } while (line === '')
      if (options.length > 0) {
        const index = Number(line)
        const selected = Number.isInteger(index) && index >= 1 && index <= options.length
          ? [options[index - 1]!.label]
          : []
        // Anything that is not a row number is the typed answer.
        answers.push({
          id: question.id,
          selected,
          ...(selected.length === 0 ? { custom: line } : {}),
        })
      } else {
        answers.push({ id: question.id, selected: [], custom: line })
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
    // A pasted file path starts with `/` too; only a bare command word is one.
    if (isCommandLine(text)) {
      const command = text.slice(1).split(/\s+/u)[0]?.toLowerCase()
      if (command === 'status') {
        write(`session ${sessionId ?? '-'}`)
        write(`cwd     ${options.cwd}`)
      } else if (command === 'help') {
        write('/help /sessions /new /resume /model /rename /cancel /status /clear /quit')
      } else if (command === 'cancel') {
        if (sessionId !== undefined) await backend.cancel(sessionId)
      } else {
        // Not one of the few client commands plain mode carries: the Host's own
        // catalog may still own the word, `/compact` among them. Print what
        // settled, because a line-based session has no step rows to show it.
        if (sessionId === undefined) {
          write(t('plain.unknownCommand', { command: command ?? '' }))
          return
        }
        try {
          const settled = await backend.runCommand(sessionId, text)
          if (settled === undefined) write(t('plain.unknownCommand', { command: command ?? '' }))
          else if (settled.kind === 'error') write(`! ${settled.text}`)
          else if (settled.text !== undefined) write(settled.text)
        } catch (caught) {
          write(`! ${caught instanceof Error ? caught.message : String(caught)}`)
        }
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
