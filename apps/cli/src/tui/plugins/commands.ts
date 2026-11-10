/**
 * One line of text becomes work: a slash command, or a prompt delivered to the
 * open Session.
 *
 * This is the client's whole command surface. It lives in one plugin because the
 * two halves are the same decision — a line starting with `/` is a command and
 * everything else is a prompt — and because the delivery mode is a rule, not a
 * preference: `Enter` steers a running turn and starts one when idle, the queue
 * chord always asks for a follow-up. Before this, that rule was re-derived at
 * three call sites.
 *
 * Drafts typed before a Session exists are kept here and replayed when one
 * opens, which is why this plugin listens to `hulala/session-opened` instead of
 * being called by the session.
 *
 * @module hulala-cli/tui/plugins/commands
 */
import type { Context } from '@deepseek-ai/cordis'
import type { TerminalPromptMode, TerminalSession } from '../data/remote.js'
import { languageName, parseLanguage } from '../../language.js'
import { KEY_ACTIONS, actionHint } from '../../keymap.js'
import type { PaneKind } from '../pane/focus.js'
import type { CatalogEntry } from '../commandCatalog.js'
import { resolveHostCommand, setHostCommands } from '../commandCatalog.js'
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
  /** Move every queued occurrence back into the composer. */
  dequeue(): Promise<void>
  /** `Enter` steers a running turn; the queue chord always queues. */
  modeFor(gesture: 'enter' | 'accelerated'): TerminalPromptMode
  /** Ask the Host to abort the running turn. */
  cancel(): Promise<void>
  /**
   * `Cmd-E` / `/nvim`: leave only the editor column, or come back from it.
   *
   * The mode lives here because both entry points must share one snapshot: the
   * key and the slash command are the same action, and a command that opened the
   * view without recording what it replaced would make the next `Cmd-E` restore
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

  /** Drafts typed before a Session existed, kept with the mode their gesture named. */
  const pendingLines: Array<{ line: string; mode: TerminalPromptMode }> = []
  /** Commands contributed by user plugins, keyed by the word after the slash. */
  const extra = new Map<string, { description: string; run: (argument: string) => void | Promise<void> }>()
  let cancelRequested = false
  /** The layout from before `Cmd-E`, while Neovim-only mode is on. */
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
   * `Cmd-E`: leave only the editor column.
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

  /** `Cmd-E` again: the rail, the conversation and the keyboard as they were. */
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
   * `Cmd-E` / `/nvim` toggles Neovim-only mode.
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

  const runCommand = async (line: string): Promise<void> => {
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/u.exec(line.trim())
    if (match === null) return
    const command = match[1]?.toLowerCase() ?? ''
    const argument = (match[2] ?? '').trim()
    switch (command) {
      case 'help':
        await overlays.modal<undefined>(done => new HelpOverlay({
          color: config.color,
          rows: () => terminal.rows,
          onClose: () => done(undefined),
        }), { anchor: 'center', width: 74 })
        return
      case 'language': {
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
        return
      }
      case 'quit':
      case 'exit':
        ctx.emit('hulala/quit')
        return
      case 'sessions':
      case 'resume':
        if (argument !== '') await session.open(argument)
        else await session.browse()
        return
      case 'new':
        await session.startNew()
        return
      case 'model':
        await session.chooseModel(argument)
        return
      case 'thinking':
        await session.chooseThinking(argument)
        return
      case 'permission':
        await session.choosePermission(argument)
        return
      case 'login':
        await session.login(argument)
        return
      case 'cancel':
        await cancel()
        return
      case 'rename':
      case 'name': {
        if (session.id === undefined || argument === '') return
        try {
          await backend.rename(session.id, argument)
          reducer.addNotice(t('notice.renamed', { title: argument }))
        } catch (caught) {
          failure(caught)
          return
        }
        repaint()
        return
      }
      case 'status': {
        const row = (label: string, value: string): void => { reducer.addNotice(`${label.padEnd(8)}${value}`) }
        reducer.addNotice(`hulala  v${VERSION}`)
        if (updater.available !== undefined) reducer.addNotice(t('status.updateAvailable', { version: updater.available.latestVersion }))
        row(t('status.label.host'), backend.host.url === '' ? '-' : backend.host.url)
        row(t('status.label.session'), session.id ?? '-')
        row(t('status.label.cwd'), session.cwd)
        const route = session.model === undefined ? '-' : `${session.model.provider}/${session.model.model}`
        row(t('status.label.model'), session.thinkingLevel === undefined ? route : `${route} • ${session.thinkingLevel}`)
        row(t('status.label.permission'), session.permission === undefined ? '-' : permissionLabel(session.permission))
        row(t('status.label.pane'), panes.visible === undefined ? '-' : `${panes.visible}${panes.focused ? ` ${t('status.value.focus')}` : ''}`)
        row(t('status.label.rail'), layout.railWanted ? (rail.focused ? `${t('status.value.visible')} ${t('status.value.focus')}` : t('status.value.visible')) : t('status.value.hidden'))
        row(t('status.label.chat'), layout.conversationShown ? t('status.value.visible') : t('status.value.hidden'))
        row(t('status.label.turn'), reducer.busy ? t('status.value.running') : t('status.value.idle'))
        repaint()
        return
      }
      case 'clear':
        reducer.reset()
        repaint()
        return
      case 'changelog':
        changelog.show(argument)
        return
      case 'reasoning': {
        const mode = view.cycleReasoning()
        const label = mode === 'summary' ? 'reasoning.summary' : mode === 'full' ? 'reasoning.full' : 'reasoning.hidden'
        reducer.addNotice(t('notice.reasoning', { mode: t(label) }))
        repaint()
        return
      }
      case 'update':
        await updater.install()
        return
      case 'restart':
        // The installed release may already be newer than this process (another
        // window updated); a swap needs no network and no confirmation.
        updater.requestRestart()
        return
      case 'editor':
        panes.toggle('editor', session.cwd)
        return
      case 'terminal':
      case 'shell':
        panes.toggle('terminal', session.cwd)
        return
      case 'nvim':
        // The same action as `Cmd-E`, snapshot included: a command that built the
        // view without recording what it replaced would make the next `Cmd-E`
        // restore nothing.
        toggleEditorOnly()
        return
      case 'rail':
        rail.toggle()
        return
      case 'chat':
        if (layout.conversationShown) {
          if (!layout.railShown && layout.paneId === undefined) {
            reducer.addNotice(t('input.keepColumn'))
            repaint()
            return
          }
          layout.setConversationVisible(false)
          // The composer left the frame with the conversation. A column that
          // already owns the keyboard keeps it; the composer's keyboard goes to a
          // column still painted, or to the rail.
          if (!panes.focused && !rail.focused) {
            if (panes.visible !== undefined) panes.focus(panes.visible, session.cwd)
            else rail.focus()
          }
        } else {
          layout.setConversationVisible(true)
          if (panes.focused) panes.blur()
          else if (rail.focused) rail.blur()
          else focusOn(editor)
        }
        repaint()
        return
      case 'commands':
      case 'palette':
        await openPalette()
        return
      case 'keys':
        showKeys()
        return
      default: {
        const contributed = extra.get(command)
        if (contributed !== undefined) {
          try {
            await contributed.run(argument)
          } catch (caught) {
            failure(caught)
          }
          return
        }
        // Not a client command: the Host's catalog may still own the word
        // (`/compact` is a plugin row). Dispatch it and say nothing here — the
        // outcome arrives as the durable `command/run`/`command/done` pair the
        // transcript renders, exactly as the web client leaves it to the log.
        const hosted = resolveHostCommand(command)
        if (hosted === undefined || session.id === undefined) {
          reducer.addError(t('error.unknownCommand', { command }))
          repaint()
          return
        }
        try {
          const line = argument === '' ? `/${hosted.name}` : `/${hosted.name} ${argument}`
          if (await backend.runCommand(session.id, line) === undefined) {
            reducer.addError(t('error.unknownCommand', { command }))
            repaint()
          }
        } catch (caught) {
          failure(caught)
        }
        return
      }
    }
  }

  const submit = async (line: string, mode: TerminalPromptMode): Promise<void> => {
    if (lifecycle.closing) return
    const text = line.trim()
    if (text === '') return
    if (text.startsWith('/')) {
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
    dequeue,
    openPalette,
    toggleEditorOnly,
    modeFor: gesture => (gesture === 'accelerated' || !reducer.busy ? 'queue' : 'steer'),
    cancel,
    registerCommand: (name: string, description: string, run: (argument: string) => void | Promise<void>) => {
      const key = name.toLowerCase()
      extra.set(key, { description, run })
      return () => {
        // A later registration for the same word owns it now.
        if (extra.get(key)?.run !== run) return
        extra.delete(key)
      }
    },
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
