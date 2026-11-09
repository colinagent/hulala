/**
 * Self-update: the notice, the swap, and the flag that makes the client come
 * back as the new release.
 *
 * The *download* is never this plugin's business. A release archive is about
 * twelve megabytes, so a startup only asks the index what the stable version is
 * and says so; `/update` fetches and installs on the spot, when the user asked
 * for it. Downloading on every launch would leave packages in `cache/releases`
 * for a machine that never chose to install them.
 *
 * It owns four facts the rest of the client reads through one service: whether a
 * release is known, whether the notice was already shown, whether a swap is
 * under way (`restartWanted`, the answer `shutdown()` asks for), and whether
 * `hulala update` is running from this window (a recovery probe must not race
 * the install it is waiting for).
 *
 * It also owns *recovery*: when the event connection drops because another
 * terminal updated or restarted the Host, every window has to become a new
 * process — the transport is bound to one endpoint and cookie, so there is no
 * re-attach. This plugin watches `hulala/session-disconnected` and hands the
 * terminal over as soon as the installed release differs from this process, or
 * a live Host for this release appears. When neither happens (the user ran
 * `hulala host stop`), it says so once and leaves the window alone: reviving a
 * daemon the user stopped is not a client's decision.
 *
 * @module hulala-cli/tui/plugins/update
 */
import type { Context } from '@deepseek-ai/cordis'
import { t } from '../i18n/index.js'
import { VERSION } from '../../constants.js'
import { inspectHost } from '../../hostAttach.js'
import { installedRelease, type InstalledRelease } from '../../distribution/installedRelease.js'
import { resolvePaths } from '../../paths.js'
import type { UpdateInfo } from '../../update/check.js'
import { UpdateConfirmOverlay } from '../view/overlays/updateConfirm.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The pending release, its notice, and the swap flag. */
    hulalaUpdate: TuiUpdate
  }
  interface Events {
    /** A release was installed; the caller should close the window. */
    'hulala/update-installed'(): void
  }
}

/** What the client asks the updater for. */
export interface TuiUpdate {
  /** The newer release the background check found, if any. */
  readonly available: UpdateInfo | undefined
  /** Whether the exit now under way is a swap onto a new release. */
  readonly restartWanted: boolean
  /** Whether `hulala update` is running from this window. */
  readonly installing: boolean
  /** Record what the background check found. */
  offer(info: UpdateInfo | undefined): void
  /**
   * Show the reminder once, and only for a Session that exists.
   *
   * The transcript is reset when a Session opens, so the check can finish before
   * the first one is open; the startup sequence announces from its end instead.
   */
  announce(): void
  /**
   * Install the release that is already on disk.
   * @returns the failure message, or undefined when the swap is ready.
   */
  install(): Promise<string | undefined>
  /** Hand the terminal to the installed release and exit. */
  requestRestart(): void
}

/** Apply hook plus the notice sink. */
export interface UpdatePluginConfig {
  /** Runs `hulala update` the way the shell would; tests inject a fixed result. */
  readonly applyUpdate?: () => Promise<{ ok: boolean; message: string }>
  /** State root holding `bin/hulala` and the release cache; defaults to the process root. */
  readonly dataRoot?: string
  /** Colour flag for the confirmation panel. */
  readonly color?: boolean
  /** Injected for tests: how often a dropped connection is re-examined. */
  readonly probeMs?: number
}

/** What a window does when its event connection drops. */
export type RecoveryDecision =
  /** The daemon still answers and may recover; keep watching. */
  | 'watch'
  /** Become a new process: a release was installed or the daemon was replaced. */
  | 'restart'
  /** The Host was stopped and this process is already the installed release. */
  | 'stopped'
  /** Another release serves as Host; a restart could not attach either. */
  | 'mismatch'

/** What the decision needs to know. */
export interface RecoveryFacts {
  /** The daemon discovered for this state root, when one answers. */
  readonly live: { readonly version: string; readonly instanceId: string } | undefined
  /** Instance this process attached to; absent when the backend does not know. */
  readonly mine: string | undefined
  /** Release the launcher would start; absent outside an installation. */
  readonly installed: string | undefined
  /** Release this process runs. */
  readonly version: string
}

/**
 * Decide what a dropped connection means.
 *
 * The transport cannot be pointed at another endpoint, so a window either keeps
 * watching the daemon it attached to, starts over as a new process, or stays put
 * because nothing it could do would help: `hulala host stop` must not be undone
 * by clients, and a Host running another release cannot be attached to.
 * @param facts - daemon, installation and this process.
 * @returns what the caller should do next.
 */
export function decideRecovery(facts: RecoveryFacts): RecoveryDecision {
  const stale = facts.installed !== undefined && facts.installed !== facts.version
  if (facts.live !== undefined) {
    const mine = facts.mine !== undefined && facts.live.instanceId === facts.mine
    // A release installed elsewhere ends this process's usefulness even while
    // its old daemon answers: the window would keep serving old code.
    if (mine && !stale) return 'watch'
    if (facts.live.version === facts.version || stale) return 'restart'
    return 'mismatch'
  }
  return stale ? 'restart' : 'stopped'
}

/** How often a dropped connection is re-examined while recovery waits. */
const PROBE_MS = 2_000

/** A decision that needs no action is re-examined less often than the first look. */
const IDLE_PROBE_MS = 10_000

/** Provide the updater. */
export function apply(ctx: Context, config: UpdatePluginConfig): void {
  const render = ctx.hulalaRender
  const { reducer } = ctx.hulalaViewModel
  const session = ctx.hulalaSession
  const panes = ctx.hulalaPanes
  const overlays = ctx.hulalaOverlays
  const dataRoot = config.dataRoot ?? resolvePaths().data

  let available: UpdateInfo | undefined
  let announced = false
  let restartWanted = false
  let installing = false
  /** Set once this window asked for a swap; a probe then stands down. */
  let swapping = false

  let probeTimer: ReturnType<typeof setTimeout> | undefined

  const installed = async (): Promise<InstalledRelease | undefined> =>
    await installedRelease(dataRoot).catch(() => undefined)

  const stopProbe = (): void => {
    if (probeTimer !== undefined) clearTimeout(probeTimer)
    probeTimer = undefined
  }

  /** Ask for a process swap; the exit that follows lands on the installed release. */
  const requestRestart = (): void => {
    if (swapping) return
    swapping = true
    restartWanted = true
    stopProbe()
    render.repaint()
    ctx.emit('hulala/update-installed')
  }

  /** Say one thing once; a dropped connection retries every second. */
  let lastNotice = ''
  const say = (text: string): void => {
    if (text === lastNotice) return
    lastNotice = text
    reducer.addNotice(text)
    render.repaint()
  }

  /**
   * Decide what a dropped connection means.
   *
   * The transport cannot be pointed at another endpoint, so there are exactly
   * three useful outcomes: keep watching the daemon this window attached to,
   * become a new process (a release was installed or the daemon was replaced),
   * or leave the window alone because the Host was stopped on purpose.
   */
  async function probe(): Promise<void> {
    probeTimer = undefined
    if (swapping || installing || ctx.hulalaLifecycle.closing) return
    if (!session.disconnected) return
    const live = await inspectHost().catch(() => ({ state: 'stopped' } as const))
    const current = await installed()
    const decision = decideRecovery({
      live: live.state === 'running'
        ? { version: live.record.version, instanceId: live.record.descriptor.instanceId }
        : undefined,
      mine: ctx.backend.host.instanceId,
      installed: current?.version,
      version: VERSION,
    })
    if (decision === 'watch') return schedule(IDLE_PROBE_MS)
    if (decision === 'mismatch') {
      say(t('notice.hostMismatch', { host: live.state === 'running' ? live.record.version : '?', client: VERSION }))
      return schedule(IDLE_PROBE_MS)
    }
    if (decision === 'stopped') {
      // `hulala host stop` is a user action; reviving the daemon is not this
      // window's call. The notice names the way back.
      say(t('notice.hostStopped', { version: VERSION }))
      return schedule(IDLE_PROBE_MS)
    }
    // A newer release was installed elsewhere: this process can simply stop
    // being the old one. Otherwise a daemon for this release replaced ours and
    // the window has to attach to it with a fresh cookie.
    if (current !== undefined && current.version !== VERSION) {
      reducer.addNotice(t('update.restarting', { version: current.version }))
      render.repaint()
    } else {
      say(t('notice.hostReplaced'))
    }
    requestRestart()
  }

  /**
   * Look again later.
   * @param delay - how long to wait; a decision that needs no action can afford
   *   to be slower than the first look after a disconnect.
   */
  function schedule(delay = config.probeMs ?? PROBE_MS): void {
    if (probeTimer !== undefined || swapping || ctx.hulalaLifecycle.closing) return
    probeTimer = setTimeout(() => { void probe() }, delay)
  }

  // A window whose Host stopped is the only place recovery can start: the
  // update happened elsewhere, and nothing pushes that fact to this process.
  ctx.on('hulala/session-disconnected', () => { schedule() })

  ctx.effect(() => () => { stopProbe() }, 'hulala: update probes')

  /** The confirmation panel, with what this window would lose. */
  const confirmed = async (version: string): Promise<boolean> => {
    const running = Math.max(session.sessions.filter(entry => entry.running).length, reducer.busy ? 1 : 0)
    const choice = await overlays.modal<'continue' | 'cancel'>(done => new UpdateConfirmOverlay({
      color: config.color ?? false,
      facts: { version, running, panes: panes.running },
      onChoose: done,
    }), { anchor: 'center', width: 72 }, { value: 'cancel' })
    return choice === 'continue'
  }

  ctx.provide('hulalaUpdate', {
    get available() { return available },
    get restartWanted() { return restartWanted },
    get installing() { return installing },
    offer: (info: UpdateInfo | undefined) => {
      available = info
    },
    announce: () => {
      // A notice needs a transcript. The background check usually finishes
      // before the first Session exists, and repainting then paints nothing, so
      // the reminder waits instead of being spent unseen.
      if (available === undefined || announced || session.id === undefined) return
      announced = true
      reducer.addNotice(
        available.downloaded === true
          ? t('update.downloaded', { version: available.latestVersion })
          : t('update.available', { current: available.currentVersion, latest: available.latestVersion }),
        available.downloaded === true ? 'info' : 'warn',
      )
      render.repaint()
    },
    install: async () => {
      if (installing || swapping) return undefined
      // Another window may already have installed it. Switching is then a file
      // read and an exec, not a download: the fast path that makes a stale
      // window recover in a second.
      const current = await installed()
      if (current !== undefined && current.version !== VERSION) {
        reducer.addNotice(t('update.restarting', { version: current.version }))
        render.repaint()
        requestRestart()
        return undefined
      }
      if (config.applyUpdate === undefined) return t('update.cannotSelf')
      const version = available?.latestVersion ?? VERSION
      if (!await confirmed(version)) return undefined
      reducer.addNotice(t('update.installing'))
      render.repaint()
      installing = true
      try {
        const result = await config.applyUpdate().catch((caught: unknown) => ({
          ok: false,
          message: caught instanceof Error ? caught.message : String(caught),
        }))
        if (!result.ok) {
          reducer.addError(result.message)
          render.repaint()
          return result.message
        }
        reducer.addNotice(result.message)
        requestRestart()
        return undefined
      } finally {
        installing = false
      }
    },
    requestRestart,
  })
}

/** Cordis object-form plugin. */
export const updatePlugin = {
  name: 'hulala-update',
  inject: ['hulalaRender', 'hulalaViewModel', 'hulalaSession', 'hulalaPanes', 'hulalaOverlays', 'hulalaLifecycle'],
  apply,
}
