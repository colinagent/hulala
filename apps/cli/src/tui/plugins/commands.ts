/**
 * One line of text becomes work: a slash command, or a prompt delivered to the
 * open Session.
 *
 * This is the client's whole command surface. It lives in one plugin because the
 * two halves are the same decision — a line whose first word is in the command
 * registry is a command, and everything else is a prompt — and because the
 * delivery mode is a rule, not a preference: `Enter` steers a running turn and
 * starts one when idle, the queue chord always asks for a follow-up.
 *
 * The registry lives in `../commandCatalog.ts`: it is the single table behind the
 * `/` menu, the palette, `/help`, completion, the aliases, the whitelist and the
 * handler map below. The map is typed by the registry's name union, so adding a
 * command without a handler does not compile, and a pasted absolute path is a
 * prompt because it is not in the whitelist.
 *
 * Drafts typed before a Session exists are kept here and replayed when one
 * opens, which is why this plugin listens to `hulala/session-opened` instead of
 * being called by the session.
 *
 * @module hulala-cli/tui/plugins/commands
 */
import { readFile, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { PasteFile, TerminalPromptMode, TerminalSession } from '../data/remote.js'
import { liveImageReadPorts, readClipboardPaste } from '../clipboard.js'
import { draftFromClipboard } from '../paste.js'
import { languageName, parseLanguage } from '../../language.js'
import { KEY_ACTIONS, actionHint } from '../../keymap.js'
import type { PaneKind } from '../pane/focus.js'
import type { CatalogEntry } from '../commandCatalog.js'
import { clientCommandName, isCommandLine, parseCommandLine, resolveHostCommand, setHostCommands, type ClientCommandName } from '../commandCatalog.js'
import { t } from '../i18n/index.js'
import { permissionLabel } from '../view/permission.js'
import { CommandPaletteOverlay } from '../view/overlays/commandPalette.js'
import { HelpOverlay } from '../view/overlays/help.js'
import { VERSION } from '../../constants.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Slash commands, prompt delivery, and the queue drain. */
    hulalaCommands: TuiCommands
  }
  interface Events {
    /** A command asked the client to quit; the boot code owns the exit. */
    'hulala/quit'(): void
    /** The terminal went away; there is nobody left to show a dialog to. */
    'hulala/hangup'(): void
  }
}

/** What the client calls to turn input into work. */
export interface TuiCommands {
  /**
   * Handle one submitted line.
   * @param line - the draft, submitted as typed.
   * @param mode - Host delivery mode for prompt text.
   */
  submit(line: string, mode: TerminalPromptMode): Promise<void>
  /** Read the clipboard and put it in the draft as a path or as text. */
  paste(): Promise<void>
  /** Move every queued occurrence back into the composer. */
  dequeue(): Promise<void>
  /** `Enter` steers a running turn; the queue chord always queues. */
  modeFor(gesture: 'enter' | 'accelerated'): TerminalPromptMode
  /** Ask the Host to abort the running turn. */
  cancel(): Promise<void>
  /**
   * `Ctrl-D` / `Ctrl-F` / `Ctrl-T` / `Ctrl-G`: take the keyboard to one panel,
   * or put that panel away.
   *
   * One implementation for four chords and four slash commands (`/rail`,
   * `/chat`, `/terminal`, `/editor`) because the cycle is one rule. The frame
   * never loses its last panel: hiding the only one left is refused with a
   * notice.
   * @param panel - the panel the chord names.
   */
  focusPanel(panel: FramePanel): void
  /**
   * `Ctrl-Shift-G` / `/nvim`: leave only the editor column, or come back from it.
   *
   * The mode lives here because both entry points must share one snapshot: the
   * key and the slash command are the same action, and a command that opened the
   * view without recording what it replaced would make the next `Ctrl-Shift-G` restore
   * nothing.
   */
  toggleEditorOnly(): void
  /**
   * Open the command palette from anywhere.
   *
   * The palette is the surface for a forgotten shortcut and for a terminal that
   * cannot deliver a Command chord: it closes first, then runs the chosen
   * command, so a command that opens its own panel is not stacking two modals.
   */
  openPalette(): Promise<void>
  /**
   * Add a `/command` from outside this plugin (a user plugin's `tui.command`).
   * @param name - the word after the slash, lowercased on lookup.
   * @param description - one line for `/help`.
   * @param run - receives the trimmed argument.
   * @returns idempotent removal.
   */
  registerCommand(name: string, description: string, run: (argument: string) => void | Promise<void>): () => void
}

/** The frame to come back to after Neovim-only mode. */
interface FrameSnapshot {
  readonly rail: boolean
  readonly chat: boolean
  readonly focus: 'composer' | 'rail' | 'pane'
  readonly pane: PaneKind | undefined
}

/**
 * The four panels a key takes the keyboard to.
 *
 * The right column is one panel whichever program it holds, so `terminal` and
 * `editor` are two names for the same seat — the key names which program should
 * be in it.
 */
export type FramePanel = 'rail' | 'chat' | 'terminal' | 'editor'

/** Colour flag for the help overlay. */
export interface CommandsPluginConfig {
  readonly color: boolean
}

/** Provide the command surface. */
export function apply(ctx: Context, config: CommandsPluginConfig): void {
  const backend = ctx.backend
  const render = ctx.hulalaRender
  const overlays = ctx.hulalaOverlays
  const session = ctx.hulalaSession
  const panes = ctx.hulalaPanes
  const keymap = ctx.hulalaKeymap
  const { terminal, focus: focusOn } = ctx.hulalaTerminal
  const updater = ctx.hulalaUpdate
  const changelog = ctx.hulalaChangelog
  const rail = ctx.hulalaRail
  const layout = ctx.hulalaLayout
  const view = ctx.hulalaView
  const lifecycle = ctx.hulalaLifecycle
  const language = ctx.hulalaLanguage
  const { reducer } = ctx.hulalaViewModel
  const { editor } = ctx.hulalaComposer
  const focus = ctx.hulalaFocus

  /** Drafts typed before a Session existed, kept with the mode their gesture named. */
  const pendingLines: Array<{ line: string; mode: TerminalPromptMode }> = []
  let cancelRequested = false
  /** The layout from before `Ctrl-Shift-G`, while Neovim-only mode is on. */
  let beforeEditorOnly: FrameSnapshot | undefined

  const repaint = (): void => { render.repaint() }
  const failure = (caught: unknown): void => {
    reducer.addError(caught instanceof Error ? caught.message : String(caught))
    repaint()
  }

  /**
   * Read the Host's command rows for the Session that just opened.
   *
   * The catalog is per agent and only changes when its composition does, so it
   * is read once per open rather than on every completion keystroke. A Host that
   * cannot answer leaves the client's own commands in place instead of keeping a
   * previous Session's rows.
   */
  const loadHostCommands = async (opened: string): Promise<void> => {
    try {
      setHostCommands(await backend.commandCatalog(opened))
    } catch {
      setHostCommands([])
    }
    // A draft already holding `/` was completed before these rows arrived; the
    // menu follows the catalog without waiting for another keystroke.
    editor.refreshMenu()
    repaint()
  }

  const cancel = async (): Promise<void> => {
    if (session.id === undefined || cancelRequested) return
    cancelRequested = true
    try {
      await backend.cancel(session.id)
      reducer.addNotice(t('notice.cancelRequested'))
      repaint()
    } catch (caught) {
      cancelRequested = false
      failure(caught)
    }
  }

  /**
   * How many panels the frame is drawing.
   *
   * The rail and the conversation are independent, and the right column is one
   * panel whichever seat it holds, so the editor and the terminal never both
   * count. A panel that is wanted but does not fit (a narrow terminal) is not
   * drawn and therefore not counted: the key cannot keep something the layout
   * refused to paint.
   */
  const visiblePanels = (): number =>
    (layout.railShown ? 1 : 0)
    + (layout.conversationShown ? 1 : 0)
    + (layout.paneId === undefined ? 0 : 1)

  /**
   * Refuse to put the last panel away.
   *
   * The frame must never become empty: with nothing drawn there is no composer to
   * type into, no rail to move through and no column to look at, and the window
   * would be a blank screen with a live Agent behind it. Every panel key asks this
   * before it hides anything, so the refusal lands on the key that would have
   * closed the last surface.
   * @returns true when the hide was refused (and the refusal has been said).
   */
  const refusedLastPanel = (): boolean => {
    if (visiblePanels() > 1) return false
    reducer.addNotice(t('input.keepPanel'))
    // With the conversation away the notice has nowhere to be read yet, so the
    // refusal is also audible: the bell is what says "that key did nothing" when
    // there is no surface to print it on.
    if (!layout.conversationShown) terminal.write('\u0007')
    repaint()
    return true
  }

  /**
   * `Ctrl-D` / `Ctrl-F` / `Ctrl-T` / `Ctrl-G`: take the keyboard to a panel, or
   * put that panel away.
   *
   * The rule is the same for all four, which is why it lives in one place: a
   * panel without the keyboard takes it, a panel with it goes away, and a panel
   * that is away comes back with the keyboard on it. The conversation is the
   * keyboard's home, so hiding any other panel returns there (bringing it back on
   * screen if it had been put away); hiding the conversation itself hands the
   * keyboard to the nearest panel still drawn — the rail, then the column.
   * @param panel - the panel the chord names.
   */
  const focusPanel = (panel: FramePanel): void => {
    if (panel === 'rail') {
      if (rail.focused) {
        if (refusedLastPanel()) return
        rail.hide()
      } else {
        focus.rail()
      }
      repaint()
      return
    }
    if (panel === 'chat') {
      if (focus.panel === 'composer') {
        if (refusedLastPanel()) return
        layout.setConversationVisible(false)
        // The composer left the frame with the conversation. What is still drawn
        // takes the keyboard: the rail first, then the column that shares the
        // frame with it. One of them is up, or `refusedLastPanel` would have
        // returned above.
        if (layout.railShown) focus.rail()
        else if (panes.visible !== undefined) focus.pane(panes.visible)
      } else {
        focus.composer()
      }
      repaint()
      return
    }
    const kind: PaneKind = panel === 'editor' ? 'editor' : 'terminal'
    if (panes.focused && panes.visible === kind) {
      if (refusedLastPanel()) return
      panes.hide(kind)
      repaint()
      return
    }
    // Fetching the other program into the shared seat is the same gesture as
    // focusing this one, so a column that is not painted takes the keyboard
    // through `focus`, which starts or adopts it.
    if (panes.visible === kind) focus.pane(kind)
    else {
      rail.unfocus()
      panes.focus(kind, session.cwd)
    }
    repaint()
  }

  /**
   * `Ctrl-Shift-G`: leave only the editor column.
   *
   * The conversation refuses to hide while the rail and the sidebar are both
   * closed (`layout.setConversationVisible`), so the editor is shown and focused
   * first, then the rail goes away, then the conversation. Neovim failing to
   * start is the one case that must not produce an empty frame: the column never
   * registers, the layout is left exactly as it was, and the pane plugin has
   * already said why.
   */
  const enterEditorOnly = (): void => {
    const snapshot: FrameSnapshot = {
      rail: layout.railWanted,
      chat: layout.conversationShown,
      focus: rail.focused ? 'rail' : panes.focused ? 'pane' : 'composer',
      pane: panes.visible,
    }
    panes.focus('editor', session.cwd)
    if (layout.paneId === undefined) return
    layout.setRailVisible(false)
    layout.setConversationVisible(false)
    beforeEditorOnly = snapshot
    repaint()
  }

  /** `Ctrl-Shift-G` again: the rail, the conversation and the keyboard as they were. */
  const leaveEditorOnly = (): void => {
    const snapshot = beforeEditorOnly
    beforeEditorOnly = undefined
    layout.setConversationVisible(snapshot?.chat ?? true)
    layout.setRailVisible(snapshot?.rail ?? true)
    if (snapshot?.focus === 'rail') {
      rail.focus()
      return
    }
    if (snapshot?.focus === 'pane' && snapshot.pane !== undefined) {
      panes.focus(snapshot.pane, session.cwd)
      return
    }
    panes.blur()
    repaint()
  }

  /**
   * `Ctrl-Shift-G` / `/nvim` toggles Neovim-only mode.
   *
   * A mode whose column disappeared on its own (Neovim quit, the Session changed)
   * is not a mode any more: the frame has already brought the conversation back,
   * so the next press starts a fresh one instead of restoring a stale layout.
   */
  const toggleEditorOnly = (): void => {
    if (beforeEditorOnly !== undefined && layout.paneId !== undefined) leaveEditorOnly()
    else {
      beforeEditorOnly = undefined
      enterEditorOnly()
    }
  }

  /**
   * The command palette.
   *
   * A command that cannot run without its argument is not executed: the composer
   * comes forward with `/name ` typed, which is the same place the `/` menu would
   * have left the reader.
   */
  const openPalette = async (): Promise<void> => {
    const chosen = await overlays.modal<CatalogEntry | undefined>(done => new CommandPaletteOverlay({
      color: config.color,
      rows: () => terminal.rows,
      onResolve: done,
    }), { anchor: 'center', width: 78 })
    if (chosen === undefined || lifecycle.closing) return
    if (chosen.requiresArgument === true) {
      editor.setText(`/${chosen.name} `)
      focusOn(editor)
      render.repaint()
      return
    }
    await runCommand(`/${chosen.name}`)
  }

  /** `/keys`: reload the file, then print what is in force and what was ignored. */
  const showKeys = (): void => {
    const problems = keymap.reload()
    reducer.addNotice(`${keymap.path}`)
    for (const action of KEY_ACTIONS) {
      const keys = actionHint(action.id)
      const label = keys === '' ? t('keymap.none') : keys
      reducer.addNotice(`${label.padEnd(20)}${t(action.label)}`)
    }
    for (const problem of problems) reducer.addError(keymap.describe(problem))
    reducer.addNotice(t('keymap.reloaded', { count: keymap.actionCount }))
    repaint()
  }

  /**
   * The handler for every command in the catalog, keyed by its canonical name.
   *
   * The mapped type is the other half of the registry: a row added to `COMMANDS`
   * without a handler here does not compile, so a command can never be offered by
   * the menu and then answered with "unknown command". Aliases (`/exit`, `/name`,
   * `/shell`, `/palette`) resolve to their row before this lookup, which is why
   * they are not separate keys.
   */
  const handlers = {
    help: async () => {
      await overlays.modal<undefined>(done => new HelpOverlay({
        color: config.color,
        rows: () => terminal.rows,
        onClose: () => done(undefined),
      }), { anchor: 'center', width: 74 })
    },
    language: async argument => {
      const code = argument === '' ? await language.pick() : parseLanguage(argument)
      if (code === undefined) {
        if (argument !== '') {
          reducer.addError(t('error.languageUnsupported', { value: argument }))
          repaint()
        }
        return
      }
      const failure = language.set(code)
      if (failure !== undefined) reducer.addError(t('language.saveFailed', { reason: failure }))
      else reducer.addNotice(t('language.changed', { language: languageName(code) }))
      repaint()
    },
    quit: () => {
      ctx.emit('hulala/quit')
    },
    sessions: async argument => {
      if (argument !== '') await session.open(argument)
      else await session.browse()
    },
    resume: async argument => {
      if (argument !== '') await session.open(argument)
      else await session.browse()
    },
    new: async () => {
      await session.startNew()
    },
    'create-auto-task': async argument => {
      // A scheduled task starts as an ordinary conversation turn: the seed
      // sentence names the intent, the user appends requirements, and the
      // agent calls schedule_create. The command never sends anything itself.
      const seed = t('composer.autoTaskSeed')
      const draft = editor.getText().trim()
      const lines = draft === '' ? [] : [draft]
      if (!draft.includes(seed)) lines.push(seed)
      if (argument !== '') lines.push(argument)
      editor.setText(lines.join('\n'))
      focusOn(editor)
      render.repaint()
    },
    model: async argument => {
      await session.chooseModel(argument)
    },
    thinking: async argument => {
      await session.chooseThinking(argument)
    },
    permission: async argument => {
      await session.choosePermission(argument)
    },
    login: async argument => {
      await session.login(argument)
    },
    cancel: async () => {
      await cancel()
    },
    rename: async argument => {
      if (session.id === undefined || argument === '') return
      try {
        await backend.rename(session.id, argument)
        reducer.addNotice(t('notice.renamed', { title: argument }))
      } catch (caught) {
        failure(caught)
        return
      }
      repaint()
    },
    status: async () => {
      // One column wide enough for `permission` in English: the longest label
      // used to touch its value, which made `/status` read as one word.
      const row = (label: string, value: string): void => { reducer.addNotice(`${label.padEnd(11)}${value}`) }
      reducer.addNotice(`hulala  v${VERSION}`)
      if (updater.available !== undefined) reducer.addNotice(t('status.updateAvailable', { version: updater.available.latestVersion }))
      row(t('status.label.host'), backend.host.url === '' ? '-' : backend.host.url)
      row(t('status.label.session'), session.id ?? '-')
      row(t('status.label.cwd'), session.cwd)
      const route = session.model === undefined ? '-' : `${session.model.provider}/${session.model.model}`
      row(t('status.label.model'), session.thinkingLevel === undefined ? route : `${route} • ${session.thinkingLevel}`)
      row(t('status.label.permission'), session.permission === undefined ? '-' : permissionLabel(session.permission))
      // The other half of the same fact, and the only place it stays readable
      // after the picker closes: a Session can differ from what new Sessions get.
      await session.refreshPermissionDefault()
      row(t('status.label.defaultPermission'), session.defaultPermission === undefined
        ? '-'
        : permissionLabel(session.defaultPermission))
      row(t('status.label.pane'), panes.visible === undefined ? '-' : `${panes.visible}${panes.focused ? ` ${t('status.value.focus')}` : ''}`)
      row(t('status.label.rail'), layout.railWanted ? (rail.focused ? `${t('status.value.visible')} ${t('status.value.focus')}` : t('status.value.visible')) : t('status.value.hidden'))
      row(t('status.label.chat'), layout.conversationShown ? t('status.value.visible') : t('status.value.hidden'))
      row(t('status.label.turn'), reducer.busy ? t('status.value.running') : t('status.value.idle'))
      repaint()
    },
    clear: () => {
      reducer.reset()
      repaint()
    },
    changelog: argument => {
      changelog.show(argument)
    },
    reasoning: () => {
      const mode = view.cycleReasoning()
      const label = mode === 'tail' ? 'reasoning.tail' : mode === 'full' ? 'reasoning.full' : 'reasoning.hidden'
      reducer.addNotice(t('notice.reasoning', { mode: t(label) }))
      repaint()
    },
    update: async () => {
      await updater.install()
    },
    remote: async argument => {
      // No argument opens the picker; `local` comes back to this machine, and an
      // alias is one of the machines the picker lists. Read lazily: the switcher
      // is registered after this plugin, so naming it in `inject` would make two
      // plugins wait for each other.
      const remote = ctx.get('hulalaRemote')
      if (remote === undefined) {
        reducer.addNotice(t('error.unknownCommand', { command: 'remote' }))
        repaint()
        return
      }
      if (argument === '') await remote.choose()
      else await remote.switchTo(argument === 'local' ? undefined : argument)
    },
    restart: () => {
      // The installed release may already be newer than this process (another
      // window updated); a swap needs no network and no confirmation.
      updater.requestRestart()
    },
    editor: () => {
      focusPanel('editor')
    },
    terminal: () => {
      focusPanel('terminal')
    },
    nvim: () => {
      // The same action as `Ctrl-Shift-G`, snapshot included: a command that built
      // the view without recording what it replaced would make the next press
      // restore nothing.
      toggleEditorOnly()
    },
    rail: () => {
      focusPanel('rail')
    },
    chat: () => {
      focusPanel('chat')
    },
    commands: async () => {
      await openPalette()
    },
    keys: () => {
      showKeys()
    },
  } satisfies Record<ClientCommandName, (argument: string) => Promise<void> | void>

  /**
   * Dispatch one submitted command line.
   *
   * The line is already known to be a command (`submit` asks
   * {@link isCommandLine}), so this only decides *whose*: the client's registry
   * first, then the open Session's Host catalog (`/compact` is a plugin row).
   * A Host command is dispatched without comment — its outcome arrives as the
   * durable `command/run`/`command/done` pair the transcript renders, exactly as
   * the web client leaves it to the log.
   * @param line - the command line, slash and argument included.
   */
  const runCommand = async (line: string): Promise<void> => {
    const parsed = parseCommandLine(line)
    if (parsed === undefined) return
    const name = clientCommandName(parsed.name)
    if (name !== undefined) {
      // The registry guarantees a handler for every name; the mapped type above
      // is what keeps that true at compile time.
      const handler = handlers[name]
      if (handler !== undefined) await handler(parsed.argument)
      return
    }
    const hosted = resolveHostCommand(parsed.name)
    if (hosted === undefined || session.id === undefined) {
      reducer.addError(t('error.unknownCommand', { command: parsed.name }))
      repaint()
      return
    }
    try {
      const forwarded = parsed.argument === '' ? `/${hosted.name}` : `/${hosted.name} ${parsed.argument}`
      if (await backend.runCommand(session.id, forwarded) === undefined) {
        reducer.addError(t('error.unknownCommand', { command: parsed.name }))
        repaint()
      }
    } catch (caught) {
      failure(caught)
    }
  }

  /**
   * `Ctrl-V`: put what the clipboard holds into the draft.
   *
   * A paste is a path, the way pi does it: the model opens the file with its own
   * tools, and the user can see and re-use what was pasted. Files the clipboard
   * names stay where they are on this machine when the Host is this machine;
   * anything that has to reach another machine is written into the Host's temp
   * directory first, so the path in the draft is one the model can actually
   * open. Text is pasted as text, and a refusal is always spoken: a key that
   * silently does nothing is indistinguishable from a broken keybinding.
   */
  const paste = async (): Promise<void> => {
    if (lifecycle.closing) return
    const pasted = await readClipboardPaste(liveImageReadPorts())
    const draft = await draftFromClipboard(pasted, {
      local: backend.host.local === true,
      save: async file => await saveOnHost(file),
      read: async path => await readFile(path),
      inspect: async path => {
        const info = await stat(path)
        return { size: info.size, regular: info.isFile() }
      },
    }).catch((caught: unknown) => {
      failure(caught)
      return undefined
    })
    if (draft === undefined) return
    if (draft.kind === 'refused') {
      reducer.addNotice(t('notice.pasteProblem', { reason: draft.reason }))
      repaint()
      return
    }
    insertAtCursor(draft.kind === 'text' ? draft.text : draft.paths.join('\n'))
  }

  /**
   * Insert one pasted value at the cursor, spaced like a typed word.
   *
   * A path dropped flush against a word is not one token to anything that reads
   * the draft later; the spaces are the same ones pi adds.
   * @param text - the path or text to insert.
   */
  const insertAtCursor = (text: string): void => {
    const cursor = editor.getCursor()
    const line = editor.getText().split('\n')[cursor.line] ?? ''
    const before = cursor.col > 0 ? line[cursor.col - 1] ?? '' : ''
    const after = line[cursor.col] ?? ''
    const leading = before !== '' && !/\s/u.test(before) ? ' ' : ''
    const trailing = after !== '' && !/\s/u.test(after) ? ' ' : ''
    editor.insertTextAtCursor(`${leading}${text}${trailing}`)
    repaint()
  }

  /**
   * Write one paste on the Host and return the absolute path there.
   * @param file - the bytes and name to store.
   * @returns the path the Host wrote.
   */
  const saveOnHost = async (file: PasteFile): Promise<string> => {
    if (backend.savePaste === undefined) throw new Error(t('error.pasteRouteMissing'))
    return await backend.savePaste(file)
  }

  const submit = async (line: string, mode: TerminalPromptMode): Promise<void> => {
    if (lifecycle.closing) return
    const text = line.trim()
    if (text === '') return
    // A pasted file path starts with `/` and is a prompt, not a command: only a
    // bare command word is dispatched here.
    if (isCommandLine(text)) {
      await runCommand(text)
      return
    }
    if (session.id === undefined) {
      pendingLines.push({ line, mode })
      return
    }
    reducer.setRunning(true)
    repaint()
    try {
      await backend.prompt(session.id, line, mode)
    } catch (caught) {
      reducer.setRunning(false)
      failure(caught)
    }
  }

  /**
   * Move every pending occurrence back into the composer.
   *
   * pi's `app.message.dequeue` gesture, over a durable Host queue instead of an
   * in-process one: each row is removed from the inbox and its text is restored,
   * steering first and follow-ups after, so nothing the running turn will claim
   * is left behind. Rows carrying attachments the terminal cannot hold stay
   * queued and say so, because dropping them would silently lose another
   * client's work.
   */
  const dequeue = async (): Promise<void> => {
    if (session.id === undefined) return
    const items = [...reducer.pending.steering, ...reducer.pending.followUp]
    if (items.length === 0) {
      reducer.addNotice(t('notice.noQueued'))
      repaint()
      return
    }
    const restored: string[] = []
    let held = 0
    for (const item of items) {
      if (item.text === undefined) {
        held += 1
        continue
      }
      try {
        await backend.removeQueued(session.id, item.id)
        restored.push(item.text)
      } catch {
        // The turn claimed the occurrence between the projection and this call;
        // its text is already on its way to the transcript.
      }
    }
    const queued = restored.join('\n\n')
    const current = editor.getText()
    editor.setText([queued, current].filter(part => part.trim() !== '').join('\n\n'))
    if (restored.length > 0) {
      reducer.addNotice(t('notice.restored', { count: restored.length }))
    }
    if (held > 0) {
      reducer.addNotice(t('notice.kept', { count: held }), 'warn')
    }
    repaint()
  }

  // A turn ending clears the outstanding cancel, wherever the end came from.
  const stopStatus = backend.onSessionStatus((changed: TerminalSession['sessionId'], running: boolean) => {
    if (changed !== session.id) return
    if (!running) cancelRequested = false
  })

  ctx.on('hulala/session-opened', id => {
    cancelRequested = false
    void (async () => {
      await loadHostCommands(id)
      for (const draft of pendingLines.splice(0)) await submit(draft.line, draft.mode)
    })()
  })

  ctx.effect(() => () => {
    stopStatus()
    pendingLines.length = 0
    setHostCommands([])
  }, 'hulala: pending drafts')

  ctx.provide('hulalaCommands', {
    submit,
    paste,
    dequeue,
    openPalette,
    focusPanel,
    toggleEditorOnly,
    modeFor: (gesture: 'enter' | 'accelerated') => (gesture === 'accelerated' || !reducer.busy ? 'queue' : 'steer'),
    cancel,
  })
}

/** Cordis object-form plugin. */
export const commandsPlugin = {
  name: 'hulala-commands',
  inject: [
    'backend',
    'hulalaRender',
    'hulalaOverlays',
    'hulalaSession',
    'hulalaPanes',
    'hulalaUpdate',
    'hulalaRail',
    'hulalaLayout',
    // The panel cycle releases whichever panel held the keyboard, and that
    // arbitration lives in `plugins/focus`. Applied before this plugin.
    'hulalaFocus',
    'hulalaView',
    'hulalaLifecycle',
    'hulalaViewModel',
    'hulalaComposer',
    'hulalaLanguage',
    'hulalaTerminal',
    'hulalaKeymap',
    // `/changelog` runs through this plugin; naming it here is what makes the
    // service present when this plugin applies, instead of undefined.
    'hulalaChangelog',
  ],
  apply,
}
