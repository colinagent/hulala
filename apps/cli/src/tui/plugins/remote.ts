/**
 * `/remote` and the sidebar's host row: which machine this window is attached to.
 *
 * The list is the user's own ssh config, not an inventory Hulala invents: every
 * alias they already use for work is a machine they can pick, with whatever keys,
 * jumps and certificates that entry carries. A switch always ends in a new client
 * process, because the transport cannot be re-pointed at another origin — the
 * window becomes a new one that attaches to the chosen Host.
 *
 * @module hulala-cli/tui/plugins/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import {
  installRemote,
  listRemoteHosts,
  liveSshRunner,
  resolveRemoteHost,
  stopRemoteHost,
  type RemoteVerdict,
} from '../../remote/ssh.js'
import { VERSION } from '../../constants.js'
import { HOST_DAEMON_PROTOCOL } from '@hulala/host-client/node'
import { t } from '../i18n/index.js'
import { ChoiceOverlay } from '../view/overlays/choice.js'
import { HostSelector } from '../view/selector/host.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Which machine this window is attached to, and how to change it. */
    hulalaRemote: TuiRemote
  }
}

/** What the client asks the host switcher for. */
export interface TuiRemote {
  /** The ssh destination this window attached through, or undefined when local. */
  readonly current: string | undefined
  /** Ask which machine to attach to, and switch when one is picked. */
  choose(): Promise<void>
  /** Switch to one machine, or to this one. `undefined` means local. */
  switchTo(alias: string | undefined, options?: { confirmed?: boolean }): Promise<void>
}

/** What the switcher needs from the rest of the client. */
export interface RemotePluginConfig {
  readonly color: boolean
  /** ssh destinations to offer; defaults to the user's own config. */
  readonly hosts?: readonly string[]
  /** The ssh runner; tests inject one that answers without a network. */
  readonly runner?: import('../../remote/ssh.js').SshRunner
  /** The destination this process attached through, when it is not this machine. */
  readonly current?: string
  /** Whether a restart can start a client; defaults to the installed-client check. */
  readonly canRestart?: () => boolean
}

/**
 * Whether this process can hand the terminal to a new one.
 *
 * A source checkout (`bun run start`) deliberately refuses: the launcher it would
 * start belongs to the release installed beside the checkout, so switching Host
 * there would open the wrong build. The caller says so instead of shutting a
 * window down into nothing.
 * @param env - the environment to read; tests pass their own.
 * @returns true when a restart will start a client.
 */
export function restartSupported(env: NodeJS.ProcessEnv, entry: string | undefined): boolean {
  if ((env.HULALA_INSTALL_ROOT ?? '').trim() !== '') return true
  // A source checkout restarts its own entry (`bun run start` runs the built
  // bundle through it), which needs nothing installed.
  return entry !== undefined && entry !== ''
}

/** Apply hook: the picker, the checks and the restart. */
export function apply(ctx: Context, config: RemotePluginConfig): void {
  const canRestart = config.canRestart ?? (() => restartSupported(process.env, process.argv[1]))
  const overlays = ctx.hulalaOverlays
  const terminal = ctx.hulalaTerminal.terminal
  const render = ctx.hulalaRender
  const updater = ctx.hulalaUpdate
  const reducer = ctx.hulalaViewModel.reducer
  const runner = config.runner ?? liveSshRunner()
  const current = config.current

  const notice = (text: string): void => {
    reducer.addNotice(text)
    render.repaint()
  }

  /** One yes/no question; the safe answer is the default and also the escape. */
  const confirm = async (question: { title: string; body: readonly string[] }): Promise<boolean> => {
    const choice = await overlays.modal<'continue' | 'cancel'>(
      done => new ChoiceOverlay({ color: config.color, title: question.title, body: question.body, onChoose: done }),
      { anchor: 'center', width: 72 },
      { value: 'cancel' },
    )
    return choice === 'continue'
  }

  /** Offer what the probe implies, then leave this window for the new one. */
  /**
   * Leave this window for a new one, or explain why this build cannot.
   *
   * Only an installed client may restart itself; asking for a switch from a
   * checkout has to fail loudly *before* the window closes.
   */
  const restartInto = (remote: string | null): boolean => {
    if (!canRestart()) {
      notice(t('remote.restartUnavailable'))
      return false
    }
    updater.requestRestart({ remote })
    return true
  }

  const act = async (alias: string, verdict: RemoteVerdict): Promise<void> => {
    switch (verdict) {
      case 'attach':
      case 'start':
        restartInto(alias)
        return
      case 'install':
        if (!await confirm({
          title: t('remote.install.title', { alias }),
          body: [t('remote.install.body'), t('remote.installHint')],
        })) {
          notice(t('remote.cancelled', { alias }))
          return
        }
        break
      case 'update':
        if (!await confirm({
          title: t('remote.update.title', { alias }),
          body: [t('remote.update.body'), t('remote.updateHint')],
        })) {
          notice(t('remote.cancelled', { alias }))
          return
        }
        break
      case 'client-update':
        notice(t('remote.clientUpdate', { alias }))
        return
      case 'unreachable':
        notice(t('remote.unreachable', { alias }))
        return
    }
    notice(t('remote.installing', { alias }))
    const installed = await installRemote(alias, runner)
    if (!installed.ok) {
      // The installer's own last line is the only thing that says why: a missing
      // `curl`, a full disk, a proxy that refuses the download.
      const last = installed.output.split('\n').map(line => line.trim()).filter(line => line !== '').at(-1)
      notice(t('remote.installFailed', { alias, reason: last ?? '' }))
      return
    }
    // The installer replaces files; the daemon serving them is still the old
    // process. Stop it so the attach that follows starts the new release instead
    // of finding a Host that no longer matches this client.
    if (!await stopRemoteHost(alias, runner)) {
      notice(t('remote.stopFailed', { alias }))
      return
    }
    restartInto(alias)
  }

  const switchTo = async (alias: string | undefined): Promise<void> => {
    if (alias === current) {
      notice(t('remote.already', { host: alias ?? t('remote.local') }))
      return
    }
    if (alias === undefined) {
      // Back to this machine: the next process attaches locally, and the flag
      // that carried the tunnel is not repeated.
      restartInto(null)
      return
    }
    notice(t('remote.checking', { alias }))
    const { verdict } = await resolveRemoteHost(alias, runner, {
      version: VERSION,
      protocol: HOST_DAEMON_PROTOCOL,
    })
    await act(alias, verdict)
  }

  const choose = async (): Promise<void> => {
    const hosts = config.hosts ?? listRemoteHosts(homedir())
    const picked = await overlays.modal<string | undefined>(
      done => new HostSelector({
        hosts,
        current,
        local: t('remote.local'),
        title: t('remote.title'),
        hint: t('remote.hint'),
        empty: t('remote.empty'),
        color: config.color,
        rows: () => terminal.rows,
        onResolve: done,
        onCancel: () => done(undefined),
      }),
      { anchor: 'center', width: 72 },
    ) as string | undefined
    if (picked === undefined) return
    await switchTo(picked === '' ? undefined : picked)
  }

  ctx.provide('hulalaRemote', {
    get current() { return current },
    choose,
    switchTo,
  })
}

/** Cordis object-form plugin. */
export const remotePlugin = {
  name: 'hulala-remote',
  inject: ['hulalaOverlays', 'hulalaTerminal', 'hulalaRender', 'hulalaUpdate', 'hulalaViewModel'],
  apply,
}
