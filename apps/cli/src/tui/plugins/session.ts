/**
 * The Session this window is looking at: which one, where, with what model, and
 * the live status every other view reads.
 *
 * It owns the one fact the rest of the client shares — `cwd` — and the one
 * subscription that feeds everything else: the follow stream. That stream is why
 * this is a plugin rather than a helper: it is an open `AsyncIterable` plus a
 * control stream plus a reconnect timer, and all three must die with the window,
 * not with whichever function happened to start them.
 *
 * Two things deliberately do **not** live here. The rail and the update banner
 * react to a Session changing, so this plugin announces
 * `hulala/session-opened` instead of calling them; the composer drains drafts that
 * were typed before the first Session existed, so it listens to the same event.
 * A plugin that knows its consumers could not be replaced.
 *
 * @module hulala-cli/tui/plugins/session
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  SessionListEvent,
  TerminalModel,
  TerminalProvider,
  TerminalSession,
  TerminalSessionHandlers,
} from '../data/remote.js'
import { ApiKeyPanel, ProviderSelector, type ProviderPickerResult } from '../view/selector/login.js'
import { ModelSelector, type ModelPickerResult, type ModelSelection } from '../view/selector/model.js'
import { ResumeOverlay, type ResumeResult } from '../view/overlays/resume.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The open Session, its directory, model and list. */
    hulalaSession: TuiSession
  }
  interface Events {
    /** A Session was opened, resumed or replaced; `id` is the new one. */
    'hulala/session-opened'(id: string): void
    /** The Session list, its directory or the model changed. */
    'hulala/session-changed'(): void
    /** The event connection dropped; the client is waiting to reconnect. */
    'hulala/session-disconnected'(): void
  }
}

/** What the rest of the client may read and do with the open Session. */
export interface TuiSession {
  readonly id: string | undefined
  readonly cwd: string
  readonly model: TerminalModel | undefined
  readonly sessions: readonly TerminalSession[]
  readonly disconnected: boolean
  /** Re-read the Host's Session list; the live events keep it current. */
  refresh(): Promise<void>
  /**
   * Create a Session in the open directory (or `cwd`) without switching to it.
   * @returns the new id, or undefined when the Host refused.
   */
  create(cwd?: string): Promise<string | undefined>
  /**
   * Switch to a Session in a directory, resetting the fold state.
   * @param id - the Session to open.
   * @param directory - the directory when the caller already knows it (a fresh
   *   Session is not in the list yet).
   */
  open(id: string, directory?: string): Promise<void>
  /** Create a Session in the open directory and switch to it. */
  startNew(): Promise<void>
  /** Open `resume`, or create the first Session in `cwd`. */
  bootstrap(resume: string | undefined, cwd: string): Promise<string | undefined>
  /** Open the Session picker and switch to what it returns. */
  browse(): Promise<void>
  /** Ask the Host for the catalog and apply one choice. */
  selectModel(selection: ModelSelection): Promise<void>
  /** `/model` with or without an explicit `provider/model`. */
  chooseModel(argument: string): Promise<void>
  /** `/login [provider]`: store a provider API key and adopt its model. */
  login(argument: string): Promise<void>
}

/** Colour flag for the pickers. */
export interface SessionPluginConfig {
  readonly color: boolean
  /** The directory the client was started in, used until a Session says otherwise. */
  readonly cwd: string
}

/** Provide the open Session. */
export function apply(ctx: Context, config: SessionPluginConfig): void {
  const backend = ctx.backend
  const render = ctx.hulalaRender
  const overlays = ctx.hulalaOverlays
  const panes = ctx.hulalaPanes
  const composer = ctx.hulalaComposer
  const { terminal } = ctx.hulalaTerminal
  const { reducer } = ctx.hulalaViewModel

  let id: string | undefined
  let cwd = config.cwd
  let model: TerminalModel | undefined
  let sessions: TerminalSession[] = []
  let disconnected = false
  let followDispose: (() => void) | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  /** True once the client is closing; a reconnect must not resurrect it. */
  let shut = false

  const repaint = (): void => { render.repaint() }
  const error = (caught: unknown): void => {
    reducer.addError(caught instanceof Error ? caught.message : String(caught))
    repaint()
  }
  const announceChange = (): void => { ctx.emit('hulala/session-changed') }

  /**
   * Apply one Host Session-list event to the one array every view reads.
   *
   * `added` carries a whole summary, so it replaces the row; the others touch
   * one field each. Rows keep the Host's recency order.
   */
  const applySessionList = (event: SessionListEvent): void => {
    switch (event.kind) {
      case 'added': {
        const previous = sessions.find(session => session.sessionId === event.session.sessionId)
        const merged = {
          ...(previous ?? {}),
          ...event.session,
          ...(event.session.cwd === undefined && previous?.cwd !== undefined ? { cwd: previous.cwd } : {}),
          ...(event.session.model === undefined && previous?.model !== undefined ? { model: previous.model } : {}),
          ...(event.session.title === undefined && previous?.title !== undefined ? { title: previous.title } : {}),
          // Blank is one-way from the client's side: a summary the Host published
          // before the first prompt must not re-hide a Session that has spoken.
          blank: previous?.blank === false ? false : event.session.blank,
        }
        sessions = [
          ...sessions.filter(session => session.sessionId !== event.session.sessionId),
          merged,
        ].sort((left, right) => right.updatedAt - left.updatedAt)
        break
      }
      case 'removed':
        sessions = sessions.filter(session => session.sessionId !== event.sessionId)
        break
      case 'status':
        sessions = sessions.map(session => session.sessionId === event.sessionId ? { ...session, running: event.running } : session)
        break
      case 'activity':
        // The Host publishes activity only for a human prompt, so the same event
        // that dates the row also ends its blank state — including prompts sent
        // by another client this rail is not following.
        sessions = sessions
          .map(session => session.sessionId === event.sessionId
            ? { ...session, updatedAt: event.updatedAt, blank: false }
            : session)
          .sort((left, right) => right.updatedAt - left.updatedAt)
        break
    }
    announceChange()
    repaint()
  }

  const reconnect = (): void => {
    if (shut || id === undefined || reconnectTimer !== undefined) return
    disconnected = true
    ctx.emit('hulala/session-disconnected')
    repaint()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      if (shut || id === undefined) return
      const resume = id
      void open(resume).catch(() => undefined)
    }, 1_000)
  }

  const handlers: TerminalSessionHandlers = {
    onEvent: event => {
      // The Host writes a title after the first turn; take it from the journal
      // so the rail renames the row without waiting for the list projection.
      if (event.type === 'session/title' && id !== undefined) {
        const title = (event.data as { title?: unknown }).title
        if (typeof title === 'string' && title.trim() !== '') {
          sessions = sessions.map(session => session.sessionId === id ? { ...session, title } : session)
        }
      }
      // A human prompt ends the blank state the rail's own `+ new session` row started
      // in. The Host publishes no second list summary for that transition, so
      // the journal is where the client learns it; injected context and
      // recalled material are not the user speaking and do not count.
      if (event.type === 'user/message' && id !== undefined) {
        const source = (event.data as { source?: { kind?: unknown } }).source
        if (source?.kind === 'user') {
          sessions = sessions.map(session => session.sessionId === id && session.blank
            ? { ...session, blank: false }
            : session)
        }
      }
      reducer.applyEvent(event)
      repaint()
    },
    onAssistantDelta: text => {
      reducer.applyDelta(text)
      repaint()
    },
    onReasoningDelta: text => {
      reducer.applyReasoningDelta(text)
      repaint()
    },
    onAssistantEnd: () => {
      reducer.endStream()
      repaint()
    },
    onError: () => {
      reducer.endStream()
      reconnect()
    },
    onRunning: running => {
      reducer.setRunning(running)
      repaint()
    },
    onContextPressure: pressure => {
      reducer.setContextPressure(pressure.projectedTokens, pressure.contextWindow)
      repaint()
    },
    onInbox: inbox => {
      reducer.setInbox(inbox)
      repaint()
    },
  }

  const open = async (next: string, directory?: string): Promise<void> => {
    if (shut) return
    const previous = id
    const previousCwd = cwd
    followDispose?.()
    followDispose = undefined
    id = next
    reducer.reset()
    disconnected = false

    const summary = sessions.find(session => session.sessionId === next)
    cwd = summary?.cwd ?? directory ?? config.cwd
    model = summary?.model
    // A column belongs to the directory it was started in, so a different
    // Session ends both processes instead of leaving the editor in the old tree.
    // A reconnect re-opens the same Session and keeps them alive.
    if (previous !== undefined && (previous !== next || previousCwd !== cwd)) panes.reset()
    if (model === undefined) {
      try {
        model = (await backend.modelCatalog()).default
      } catch {
        // A catalog failure must not block opening an existing Session.
      }
    }
    if (shut) return
    followDispose = backend.follow(next, handlers)
    ctx.emit('hulala/session-opened', next)
    repaint()
  }

  const create = async (directory?: string): Promise<string | undefined> => {
    const target = directory ?? cwd
    try {
      const workspaceId = await backend.ensureWorkspace(target)
      const created = await backend.createSession(workspaceId)
      reducer.addNotice(`created Session ${created}`)
      if (!sessions.some(session => session.sessionId === created)) {
        sessions = [{ sessionId: created, updatedAt: Date.now(), running: false, blank: true, cwd: target }, ...sessions]
      }
      return created
    } catch (caught) {
      error(caught)
      return undefined
    }
  }

  const startNew = async (): Promise<void> => {
    const created = await create()
    if (created !== undefined) await open(created, cwd)
  }

  const refresh = async (): Promise<void> => {
    try {
      sessions = await backend.listSessions()
    } catch {
      // A failed re-read keeps the list the events have already built.
    }
    announceChange()
    repaint()
  }

  const bootstrap = async (resume: string | undefined, directory: string): Promise<string | undefined> => {
    cwd = directory
    sessions = await backend.listSessions().catch(() => [] as TerminalSession[])
    const first = resume ?? await create()
    if (first === undefined) return undefined
    await open(first, directory)
    return first
  }

  const pickSession = async (): Promise<ResumeResult> => {
    sessions = await backend.listSessions().catch(() => [] as TerminalSession[])
    return await composer.panel<ResumeResult>(done => new ResumeOverlay({
      sessions,
      cwd,
      color: config.color,
      onSearch: query => backend.searchSessions(query),
      onResolve: done,
    }))
  }

  const browse = async (): Promise<void> => {
    const picked = await pickSession()
    if (picked.kind === 'session') await open(picked.sessionId)
    else if (picked.kind === 'new') await startNew()
  }

  const selectModel = async (selection: ModelSelection): Promise<void> => {
    if (id === undefined) return
    try {
      await backend.selectModel(id, selection)
      model = selection
      reducer.addNotice(`model ${selection.provider}/${selection.model}`)
      announceChange()
    } catch (caught) {
      error(caught)
      return
    }
    repaint()
  }

  const pickModel = async (): Promise<ModelPickerResult> => {
    let catalog
    try {
      catalog = await backend.modelCatalog()
    } catch (caught) {
      error(caught)
      return { kind: 'cancel' }
    }
    return await composer.panel<ModelPickerResult>(done => new ModelSelector({
      catalog,
      ...(model === undefined ? {} : { current: model }),
      color: config.color,
      rows: () => terminal.rows,
      onResolve: done,
    }))
  }

  const pickProvider = async (): Promise<TerminalProvider | undefined> => {
    let providers: TerminalProvider[]
    try {
      providers = await backend.loginProviders()
    } catch (caught) {
      error(caught)
      return undefined
    }
    if (providers.length === 0) {
      error(new Error('this Host exposes no provider that accepts an API key'))
      return undefined
    }
    const result = await composer.panel<ProviderPickerResult>(done => new ProviderSelector({
      providers,
      color: config.color,
      rows: () => terminal.rows,
      onResolve: done,
    }))
    return result.kind === 'select' ? result.provider : undefined
  }

  /**
   * Adopt the first model of a route the user just configured, unless one of its
   * models is already selected. Adding a key is a statement of intent; leaving
   * an unusable default selected would hide it.
   */
  const adoptProviderModel = async (providerId: string): Promise<void> => {
    const chosen = model === undefined ? undefined : `${model.provider}/${model.model}`
    const catalog = await backend.modelCatalog().catch(() => undefined)
    // The user may have picked a model while the catalog was settling.
    if (chosen !== (model === undefined ? undefined : `${model.provider}/${model.model}`)) return
    const group = catalog?.groups.find(candidate => candidate.id === providerId)
    if (catalog === undefined || group === undefined || group.models.length === 0) return
    if (model !== undefined && catalog.groups.some(candidate => candidate.id === model?.provider)) return
    const first = group.models[0]
    if (first === undefined) return
    await selectModel({
      provider: group.id,
      model: first.id,
      ...(first.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: first.reasoning.defaultEffort }),
    })
  }

  const login = async (argument: string): Promise<void> => {
    let provider: TerminalProvider | undefined
    if (argument === '') {
      provider = await pickProvider()
    } else {
      try {
        const providers = await backend.loginProviders()
        const wanted = argument.toLowerCase()
        provider = providers.find(candidate => candidate.id.toLowerCase() === wanted || candidate.name.toLowerCase() === wanted)
        if (provider === undefined) {
          error(new Error(`unknown provider ${argument}; run /login to pick one`))
          return
        }
      } catch (caught) {
        error(caught)
        return
      }
    }
    if (provider === undefined) return
    const apiKey = await composer.panel<string | undefined>(done => new ApiKeyPanel({
      provider,
      color: config.color,
      onResolve: done,
    }))
    if (apiKey === undefined) return
    try {
      await backend.login(provider.id, apiKey)
    } catch (caught) {
      error(caught)
      return
    }
    reducer.addNotice(`saved an API key for ${provider.name}`)
    repaint()
    await adoptProviderModel(provider.id)
  }

  const chooseModel = async (argument: string): Promise<void> => {
    if (id === undefined) return
    if (argument !== '') {
      const separator = argument.indexOf('/')
      if (separator <= 0 || separator === argument.length - 1) {
        error(new Error('use /model provider/model or /model to pick from the catalog'))
        return
      }
      await selectModel({ provider: argument.slice(0, separator), model: argument.slice(separator + 1) })
      return
    }
    const result = await pickModel()
    if (result.kind === 'cancel') return
    if (result.kind === 'login') {
      await login('')
      return
    }
    await selectModel(result.selection)
  }

  // The list events and the two failure streams are the Session's own business:
  // nothing outside needs to know a row was added rather than reloaded.
  const stopList = backend.onSessionList(applySessionList)
  const stopStatus = backend.onSessionStatus((changed) => {
    if (changed !== id) return
    repaint()
  })
  const stopErrors = backend.onSessionError((changed, message) => {
    // Only this window's Session: another client can own the row that failed.
    if (changed !== id) return
    reducer.endStream()
    reducer.addError(message)
    repaint()
  })

  ctx.effect(() => () => {
    shut = true
    stopList()
    stopStatus()
    stopErrors()
    followDispose?.()
    followDispose = undefined
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
  }, 'hulala: session stream')

  ctx.provide('hulalaSession', {
    get id() { return id },
    get cwd() { return cwd },
    get model() { return model },
    get sessions() { return sessions },
    get disconnected() { return disconnected },
    refresh,
    create,
    open: (next: string, directory?: string) => open(next, directory),
    startNew,
    bootstrap,
    browse,
    selectModel,
    chooseModel,
    login,
  })
}

/** Cordis object-form plugin. */
export const sessionPlugin = {
  name: 'hulala-session',
  inject: ['backend', 'hulalaRender', 'hulalaOverlays', 'hulalaPanes', 'hulalaComposer', 'hulalaTerminal', 'hulalaViewModel'],
  apply,
}
