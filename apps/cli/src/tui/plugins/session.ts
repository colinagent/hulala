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
import { rememberSession } from '../../clientPreferences.js'
import { t } from '../i18n/index.js'
import type {
  SessionListEvent,
  TerminalModel,
  TerminalModelCatalog,
  TerminalPermissionCatalog,
  TerminalProvider,
  TerminalSession,
  TerminalSessionHandlers,
  TerminalThinkingLevel,
} from '../data/remote.js'
import { ApiKeyPanel, ProviderSelector, type ProviderPickerResult } from '../view/selector/login.js'
import { ModelSelector, type ModelPickerResult, type ModelSelection } from '../view/selector/model.js'
import { PermissionSelector, type PermissionPickerResult } from '../view/selector/permission.js'
import { FULL_ACCESS_PRESET, permissionLabel } from '../view/permission.js'
import { ThinkingSelector, type ThinkingPickerResult } from '../view/selector/thinking.js'
import { ResumeOverlay, type ResumeResult } from '../view/overlays/resume.js'
import { PermissionConfirmOverlay } from '../view/overlays/permissionConfirm.js'
import { textOf } from '../data/viewModel.js'
import {
  defaultThinkingLevelOf,
  thinkingLevelOf,
  thinkingLevelsOf,
} from '../data/thinkingLevel.js'

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
  /**
   * The thinking level the model runs at: the effort `/model` or `/thinking`
   * recorded, else the catalog's default for that model (the Host applies it
   * either way). Undefined for a model that does not reason, or until the
   * catalog arrives.
   */
  readonly thinkingLevel: string | undefined
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
  /** `/thinking [level]`: pick or set the reasoning level of the current model. */
  chooseThinking(argument: string): Promise<void>
  /** `Shift-Tab`: advance to the next level the current model advertises. */
  cycleThinking(): Promise<void>
  /** The effective permission preset of the open Session; `undefined` until the Host reports one. */
  readonly permission: string | undefined
  /** `/permission [default] [preset]`: switch this Session or write the new-Session default. */
  choosePermission(argument: string): Promise<void>
}

/** Colour flag for the pickers. */
export interface SessionPluginConfig {
  readonly color: boolean
  /** The directory the client was started in, used until a Session says otherwise. */
  readonly cwd: string
  /**
   * State root whose `config/client.json` remembers this attachment's last
   * Session. Absent in tests that do not want the write.
   */
  readonly dataRoot?: string
  /** The attachment key: `local`, or the ssh destination this window used. */
  readonly hostKey?: string
  /** Whether the Host is on another machine, where this client's paths mean nothing. */
  readonly remote?: boolean
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
  /** The Host catalog, kept for the thinking level and for `/model`. */
  let catalog: TerminalModelCatalog | undefined
  /** The open Session's effective permission preset, mirrored from its projection. */
  let permission: string | undefined
  let sessions: TerminalSession[] = []
  /** Whether the transport is attached; a `connecting` retry still counts as up. */
  let transportUp = true
  /** The follow stream died and no replacement has been attached yet. */
  let followLost = false
  /** Whether the window has already been told it is disconnected. */
  let announcedDown = false
  let followDispose: (() => void) | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  /** Failed reopens since the last event, which is what spaces out the retries. */
  let reopenAttempts = 0
  /** True once the client is closing; a reconnect must not resurrect it. */
  let shut = false

  /**
   * The one fact the band and recovery share: this window cannot show the
   * Session live, either because the transport is reconnecting or because the
   * stream that feeds it died.
   */
  const isDisconnected = (): boolean => !transportUp || followLost

  const repaint = (): void => { render.repaint() }
  const error = (caught: unknown): void => {
    reducer.addError(caught instanceof Error ? caught.message : String(caught))
    repaint()
  }
  const announceChange = (): void => { ctx.emit('hulala/session-changed') }

  /**
   * Read the Host catalog and keep it.
   *
   * The footer names the thinking level in effect, and for a route the user
   * never touched that level is the catalog's `defaultEffort` — the same value
   * the Host applies. Reading it once per window is the cost of that sentence;
   * a failure only costs the level, never the Session.
   */
  const loadCatalog = async (): Promise<TerminalModelCatalog> => {
    const loaded = await backend.modelCatalog()
    catalog = loaded
    return loaded
  }
  const catalogOrUndefined = (): Promise<TerminalModelCatalog | undefined> =>
    loadCatalog().catch(() => undefined)

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

  /**
   * Repaint the band and tell the rest of the client about a transition.
   *
   * The event is edge-triggered on purpose: it is what starts recovery, and a
   * per-second repetition would make every probe re-arm itself.
   */
  const syncDisconnected = (): void => {
    const down = isDisconnected()
    if (down && !announcedDown) {
      announcedDown = true
      ctx.emit('hulala/session-disconnected')
    } else if (!down && announcedDown) {
      announcedDown = false
    }
    repaint()
  }

  /**
   * Attach a new follow stream after the old one died.
   *
   * A dead transport cannot accept one — the mux would park the request until a
   * socket returns — so the retry belongs to the transport reconnect, and this
   * timer only covers a stream that failed while the socket was fine. The delay
   * grows to a ceiling so a Host that refuses the stream does not get one
   * request per second for the life of the window.
   */
  const reopen = (): void => {
    if (shut || id === undefined || reconnectTimer !== undefined) return
    if (!transportUp) return
    const delay = Math.min(8_000, 1_000 * 2 ** Math.min(reopenAttempts, 3))
    reopenAttempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      if (shut || id === undefined) return
      const resume = id
      void open(resume).catch(() => undefined)
    }, delay)
    reconnectTimer.unref?.()
  }

  const handlers: TerminalSessionHandlers = {
    onEvent: event => {
      // A stream that delivers proves itself: the next failure starts its
      // retries from the shortest delay again.
      reopenAttempts = 0
      // The Host writes a title after the first turn; take it from the journal
      // so the rail renames the row without waiting for the list projection.
      if (event.type === 'session/title' && id !== undefined) {
        const title = (event.data as { title?: unknown }).title
        const listed = sessions.find(candidate => candidate.sessionId === id)
        if (typeof title === 'string' && title.trim() !== '' && listed?.title !== title) {
          sessions = sessions.map(session => session.sessionId === id ? { ...session, title } : session)
          // The window title is derived from this row, so a first name is a
          // Session change like any other.
          announceChange()
        }
      }
      // Another client can move this Session's route or level. The journal is
      // where the footer learns it, so two windows on one Session never disagree.
      if (event.type === 'model/selection' && id !== undefined) {
        const selection = event.data as { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
        if (typeof selection.provider === 'string' && typeof selection.model === 'string') {
          model = {
            provider: selection.provider,
            model: selection.model,
            ...(typeof selection.reasoningEffort === 'string' ? { reasoningEffort: selection.reasoningEffort } : {}),
          }
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
          // The journal is also where `Up` gets its history: a prompt sent
          // before this window existed — a resumed Session, another client — is
          // a prompt the reader can recall, the same way pi seeds its editor
          // from the loaded transcript. The composer dedupes, so the echo of a
          // prompt this window just submitted adds nothing.
          composer.editor.addToHistory(textOf((event.data as { content?: unknown }).content))
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
      // The socket took this stream with it. Say so, then let the transport's
      // own reconnect reopen it: a retry started while the socket is down would
      // only park a request the mux has nowhere to send.
      followLost = true
      syncDisconnected()
      reopen()
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
    onPermission: preset => {
      permission = preset
      repaint()
    },
  }

  const open = async (next: string, directory?: string): Promise<void> => {
    if (shut) return
    // Remembered per attachment, so switching Host and back resumes the Session
    // that belonged to that machine instead of whichever was used last.
    if (config.dataRoot !== undefined) {
      try {
        rememberSession(config.dataRoot, config.hostKey ?? 'local', next)
      } catch {
        // A preference that cannot be written must not stop a Session opening.
      }
    }
    const previous = id
    const previousCwd = cwd
    followDispose?.()
    followDispose = undefined
    id = next
    reducer.reset()

    const summary = sessions.find(session => session.sessionId === next)
    cwd = summary?.cwd ?? directory ?? config.cwd
    model = summary?.model
    permission = summary?.permission
    // A column belongs to the directory it was started in, so a different
    // Session ends both processes instead of leaving the editor in the old tree.
    // A reconnect re-opens the same Session and keeps them alive.
    if (previous !== undefined && (previous !== next || previousCwd !== cwd)) panes.reset()
    // The stream is attached before anything that waits on the Host: a reopen
    // whose catalog call is queued behind a stalled carrier must not be the
    // reason the transcript stops updating.
    followDispose = backend.follow(next, handlers)
    followLost = false
    ctx.emit('hulala/session-opened', next)
    syncDisconnected()
    // The footer's thinking level is the catalog default for a route nobody
    // chose. It is read now, after the Session is live, so a slow catalog costs
    // the band one value and never the conversation.
    if (model === undefined) {
      const loaded = await catalogOrUndefined()
      if (loaded !== undefined && !shut) {
        model = loaded.default
        repaint()
      }
    } else if (catalog === undefined) {
      void catalogOrUndefined().then(() => { if (!shut) repaint() })
    }
  }

  // The transport is the one component that knows whether this attachment is
  // live, and its reconnect is also the moment a follow stream can be attached
  // again: a lost socket takes every stream with it, and a retry started while
  // the socket is down would only park a request the mux has nowhere to send.
  ctx.effect(() => {
    const watch = backend.connection
    if (watch === undefined) return () => undefined
    const applyState = (): void => {
      // `connecting` still counts as up: the transport is already working on it,
      // and the follow stream's own failure is what says the data path is down.
      const next = watch.state() !== 'disconnected'
      const wasUp = transportUp
      transportUp = next
      if (!next) {
        followLost = true
        syncDisconnected()
        return
      }
      if (wasUp) {
        syncDisconnected()
        return
      }
      reopenAttempts = 0
      if (id !== undefined && followLost) {
        // The transport reconnect is the reopen; a pending timer would attach a
        // second stream over this one.
        if (reconnectTimer !== undefined) {
          clearTimeout(reconnectTimer)
          reconnectTimer = undefined
        }
        void open(id).catch(() => undefined)
      } else {
        syncDisconnected()
      }
    }
    applyState()
    return watch.subscribe(applyState)
  }, 'hulala: transport state')

  const create = async (directory?: string): Promise<string | undefined> => {
    let target = directory ?? cwd
    try {
      // A remote Host has no reason to have this machine's directory: ask the
      // Host for its own default Workspace instead of creating one from a path
      // that only exists here.
      const workspaceId = config.remote === true && directory === undefined
        ? (await backend.defaultWorkspace())?.id ?? await backend.ensureWorkspace(target)
        : await backend.ensureWorkspace(target)
      if (config.remote === true && directory === undefined) {
        const fallback = await backend.defaultWorkspace()
        if (fallback !== undefined) target = fallback.path
      }
      const created = await backend.createSession(workspaceId)
      reducer.addNotice(t('notice.createdSession', { id: created }))
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
    // A resumed id comes from another process (`/update` hands it over) or from
    // the command line, so it can name a Session that no longer exists. Opening
    // it would leave a dead subscription retrying forever; say so and start a
    // new one instead. An unreadable list proves nothing, so it is not a reason
    // to discard the id.
    const listed = await backend.listSessions().then(value => value, () => undefined)
    sessions = listed ?? []
    let first: string | undefined
    let missing = false
    if (resume !== undefined && resume !== '') {
      if (listed === undefined || listed.some(session => session.sessionId === resume)) first = resume
      else missing = true
    }
    first ??= await create()
    if (first === undefined) return undefined
    await open(first, directory)
    // After `open`, which resets the transcript: a notice before it would be
    // cleared in the same tick and the user would never learn why their Session
    // is a different one.
    if (missing && resume !== undefined) reducer.addNotice(t('notice.resumeMissing', { id: resume }))
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

  /**
   * Send one selection to the Host and adopt what it accepted.
   *
   * `session/selectModel` is also how DeepSeek Harness persists the default
   * for new Sessions, so the cached catalog's default moves with every choice;
   * the `/thinking` picker's `default` badge reads it, and a stale copy would
   * blame the wrong level.
   * @param selection - route and optional explicit effort.
   * @returns whether the Host accepted the selection.
   */
  const commitSelection = async (selection: ModelSelection): Promise<boolean> => {
    if (id === undefined) return false
    try {
      await backend.selectModel(id, selection)
    } catch (caught) {
      error(caught)
      return false
    }
    model = selection
    if (catalog !== undefined) catalog = { ...catalog, default: { ...selection } }
    announceChange()
    repaint()
    return true
  }

  const selectModel = async (selection: ModelSelection): Promise<void> => {
    if (!await commitSelection(selection)) return
    reducer.addNotice(t('notice.model', { selection: `${selection.provider}/${selection.model}` }))
    repaint()
  }

  /**
   * What `/thinking` and `Shift-Tab` need: the route, its levels, and the level
   * and default the catalog currently names.
   *
   * A route the Session has not settled on yet falls back to the Host default,
   * which is the model a new Session would use.
   */
  const loadThinking = async (): Promise<{
    route: TerminalModel
    levels: readonly TerminalThinkingLevel[]
    current: string | undefined
    defaultLevel: string | undefined
  } | undefined> => {
    let loaded: TerminalModelCatalog
    try {
      loaded = await loadCatalog()
    } catch (caught) {
      error(caught)
      return undefined
    }
    const route = model ?? loaded.default
    const levels = thinkingLevelsOf(route, loaded)
    if (levels.length === 0) {
      reducer.addNotice(t('error.thinkingUnavailable'))
      repaint()
      return undefined
    }
    return {
      route,
      levels,
      current: thinkingLevelOf(route, loaded),
      defaultLevel: defaultThinkingLevelOf(route, loaded),
    }
  }

  const applyThinking = async (level: string, route: TerminalModel): Promise<void> => {
    const accepted = await commitSelection({ provider: route.provider, model: route.model, reasoningEffort: level })
    if (!accepted) return
    reducer.addNotice(t('notice.thinking', { level }))
    repaint()
  }

  const chooseThinking = async (argument: string): Promise<void> => {
    if (id === undefined) return
    const thinking = await loadThinking()
    if (thinking === undefined) return
    if (argument.trim() !== '') {
      const wanted = argument.trim().toLowerCase()
      const level = thinking.levels.find(candidate =>
        candidate.id.toLowerCase() === wanted || candidate.name.toLowerCase() === wanted)
      if (level === undefined) {
        error(new Error(t('error.thinkingUnknown', {
          level: argument.trim(),
          levels: thinking.levels.map(candidate => candidate.id).join(', '),
        })))
        return
      }
      await applyThinking(level.id, thinking.route)
      return
    }
    const picked = await composer.panel<ThinkingPickerResult>(done => new ThinkingSelector({
      model: thinking.route.model,
      levels: thinking.levels,
      ...(thinking.current === undefined ? {} : { current: thinking.current }),
      ...(thinking.defaultLevel === undefined ? {} : { defaultLevel: thinking.defaultLevel }),
      color: config.color,
      rows: () => terminal.rows,
      onResolve: done,
    }))
    if (picked.kind === 'select') await applyThinking(picked.level, thinking.route)
  }

  const cycleThinking = async (): Promise<void> => {
    if (id === undefined) return
    const thinking = await loadThinking()
    if (thinking === undefined) return
    const index = thinking.current === undefined
      ? -1
      : thinking.levels.findIndex(level => level.id === thinking.current)
    const next = thinking.levels[(index + 1) % thinking.levels.length]
    if (next === undefined) return
    await applyThinking(next.id, thinking.route)
  }

  /** Ask once before a preset that also turns the Host's approval prompts off. */
  const confirmFullAccess = async (): Promise<boolean> => overlays.modal<boolean>(done => new PermissionConfirmOverlay({
    color: config.color,
    onDecide: done,
  }), { anchor: 'center', width: 64 })

  /** The Host permission catalog, or the reason there is none. */
  const loadPermissions = async (): Promise<TerminalPermissionCatalog | undefined> => {
    try {
      return await backend.permissionCatalog()
    } catch (caught) {
      error(caught)
      return undefined
    }
  }

  /** One preset's label for a notice, preferring the Host's configured name. */
  const permissionNameOf = (loaded: TerminalPermissionCatalog, value: string): string =>
    permissionLabel(value, loaded.options.find(option => option.value === value)?.name)

  /**
   * Switch the Session, and optionally the default for Sessions created later.
   *
   * Both writes are the Host's: the Session through its `/permission` command,
   * the default through the `permission` settings namespace. A failed default
   * write leaves the Session switched and reports the failure instead of
   * pretending the pair succeeded.
   */
  const applyPermission = async (
    loaded: TerminalPermissionCatalog,
    preset: string,
    saveDefault: boolean,
  ): Promise<void> => {
    if (id === undefined) return
    if (preset === FULL_ACCESS_PRESET && !await confirmFullAccess()) return
    try {
      await backend.setPermission(id, preset)
      if (saveDefault) await backend.setDefaultPermission(preset)
    } catch (caught) {
      error(caught)
      return
    }
    permission = preset
    const name = permissionNameOf(loaded, preset)
    reducer.addNotice(saveDefault ? t('notice.permissionDefault', { preset: name }) : t('notice.permission', { preset: name }))
    repaint()
  }

  /** Write the new-Session default without touching this Session. */
  const applyDefaultPermission = async (loaded: TerminalPermissionCatalog, preset: string): Promise<void> => {
    if (preset === FULL_ACCESS_PRESET && !await confirmFullAccess()) return
    try {
      await backend.setDefaultPermission(preset)
    } catch (caught) {
      error(caught)
      return
    }
    reducer.addNotice(t('notice.permissionDefaultOnly', { preset: permissionNameOf(loaded, preset) }))
    repaint()
  }

  /**
   * `/permission [default] [preset]`.
   *
   * A preset switches this Session; `default <preset>` writes the default only.
   * Neither form invents a permission of its own — the Host owns both writes.
   */
  const choosePermission = async (argument: string): Promise<void> => {
    if (id === undefined) return
    const words = argument.trim().split(/\s+/u).filter(word => word !== '')
    const wantsDefault = words[0] === 'default'
    if (words.length > (wantsDefault ? 2 : 1)) {
      error(new Error(t('error.permissionUsage')))
      return
    }
    const wanted = wantsDefault ? words[1] ?? '' : words[0] ?? ''
    const loaded = await loadPermissions()
    if (loaded === undefined) return
    if (wanted !== '') {
      const preset = loaded.options.find(option => option.value === wanted)
      if (preset === undefined) {
        error(new Error(t('error.permissionUnknown', {
          preset: wanted,
          presets: loaded.options.map(option => option.value).join(', '),
        })))
        return
      }
      if (wantsDefault) await applyDefaultPermission(loaded, preset.value)
      else await applyPermission(loaded, preset.value, false)
      return
    }
    if (wantsDefault) {
      error(new Error(t('error.permissionUsage')))
      return
    }
    const picked = await composer.panel<PermissionPickerResult>(done => new PermissionSelector({
      presets: loaded.options,
      ...(permission === undefined ? {} : { current: permission }),
      defaultPreset: loaded.defaultPreset,
      color: config.color,
      rows: () => terminal.rows,
      onResolve: done,
    }))
    if (picked.kind === 'cancel') return
    if (picked.kind === 'save') await applyPermission(loaded, picked.preset, true)
    else await applyPermission(loaded, picked.preset, false)
  }

  const pickModel = async (): Promise<ModelPickerResult> => {
    let loaded: TerminalModelCatalog
    try {
      loaded = await loadCatalog()
    } catch (caught) {
      error(caught)
      return { kind: 'cancel' }
    }
    return await composer.panel<ModelPickerResult>(done => new ModelSelector({
      catalog: loaded,
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
      error(new Error(t('error.noProvider')))
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
    const loaded = await catalogOrUndefined()
    // The user may have picked a model while the catalog was settling.
    if (chosen !== (model === undefined ? undefined : `${model.provider}/${model.model}`)) return
    const group = loaded?.groups.find(candidate => candidate.id === providerId)
    if (loaded === undefined || group === undefined || group.models.length === 0) return
    if (model !== undefined && loaded.groups.some(candidate => candidate.id === model?.provider)) return
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
          error(new Error(t('error.unknownProvider', { provider: argument })))
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
    reducer.addNotice(t('notice.savedKey', { provider: provider.name }))
    repaint()
    await adoptProviderModel(provider.id)
  }

  const chooseModel = async (argument: string): Promise<void> => {
    if (id === undefined) return
    if (argument !== '') {
      const separator = argument.indexOf('/')
      if (separator <= 0 || separator === argument.length - 1) {
        error(new Error(t('error.modelUsage')))
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
    get thinkingLevel() { return thinkingLevelOf(model, catalog) },
    get permission() { return permission },
    get sessions() { return sessions },
    get disconnected() { return isDisconnected() },
    refresh,
    create,
    open: (next: string, directory?: string) => open(next, directory),
    startNew,
    bootstrap,
    browse,
    selectModel,
    chooseModel,
    login,
    chooseThinking,
    cycleThinking,
    choosePermission,
  })
}

/** Cordis object-form plugin. */
export const sessionPlugin = {
  name: 'hulala-session',
  inject: ['backend', 'hulalaRender', 'hulalaOverlays', 'hulalaPanes', 'hulalaComposer', 'hulalaTerminal', 'hulalaViewModel'],
  apply,
}
