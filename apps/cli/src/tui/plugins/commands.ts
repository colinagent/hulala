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
import { t } from '../i18n/index.js'
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
   * Add a `/command` from outside this plugin (a user plugin's `tui.command`).
   * @param name - the word after the slash, lowercased on lookup.
   * @param description - one line for `/help`.
   * @param run - receives the trimmed argument.
   * @returns idempotent removal.
   */
  registerCommand(name: string, description: string, run: (argument: string) => void | Promise<void>): () => void
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
  const updater = ctx.hulalaUpdate
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

  const repaint = (): void => { render.repaint() }
  const failure = (caught: unknown): void => {
    reducer.addError(caught instanceof Error ? caught.message : String(caught))
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

  const runCommand = async (line: string): Promise<void> => {
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/u.exec(line.trim())
    if (match === null) return
    const command = match[1]?.toLowerCase() ?? ''
    const argument = (match[2] ?? '').trim()
    switch (command) {
      case 'help':
        await overlays.modal<undefined>(done => new HelpOverlay({ color: config.color, onClose: () => done(undefined) }), { anchor: 'center', width: 74 })
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
        row(t('status.label.model'), session.model === undefined ? '-' : `${session.model.provider}/${session.model.model}`)
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
      case 'editor':
        panes.toggle('editor', session.cwd)
        return
      case 'terminal':
      case 'shell':
        panes.toggle('terminal', session.cwd)
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
        reducer.addError(t('error.unknownCommand', { command }))
        repaint()
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

  ctx.on('hulala/session-opened', () => {
    cancelRequested = false
    void (async () => {
      for (const draft of pendingLines.splice(0)) await submit(draft.line, draft.mode)
    })()
  })

  ctx.effect(() => () => {
    stopStatus()
    pendingLines.length = 0
  }, 'hulala: pending drafts')

  ctx.provide('hulalaCommands', {
    submit,
    dequeue,
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
  ],
  apply,
}
