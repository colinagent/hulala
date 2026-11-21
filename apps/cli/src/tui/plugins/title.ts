/**
 * The terminal's window title: the machine the Session works on, the product
 * name, the Session's directory, and its title once the Host has named it.
 *
 * A terminal tab is how a user finds the window again among a shell, an editor
 * and four Hulala Sessions, so the title says where the Session works — and on
 * which machine — before it says which Session it is. The machine prefixes the
 * directory the way scp writes a remote path (`root@dev:pi`), and a local window
 * names no machine at all: the directory alone is this machine. The directory
 * comes from the Session projection rather than the launch directory, so a
 * remote workspace reads as the path the Host is working in.
 *
 * This is a listener, not a service: nothing else needs the title, and the
 * Session plugin must not know who reads its changes. The directory arrives with
 * `hulala/session-changed`, the title with the Host's `session/title` journal
 * event, which the Session plugin turns into the same announcement.
 *
 * @module hulala-cli/tui/plugins/title
 */
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { machineLabel, remoteIdentity, type MachineIdentity } from '../../machine.js'

/** The name the title starts with, matching what the product calls itself. */
export const APP_TITLE = 'Hulala'

/** What the window title is composed from. */
export interface WindowTitleOptions {
  /** The product name in front; the constants own what it is. */
  readonly app?: string
  /** The attached machine, or undefined to leave it out of the title. */
  readonly machine?: MachineIdentity | undefined
}

/**
 * Compose the window title.
 *
 * `<machine>:<directory> - <app>:<Session title>` is the whole title, where the
 * machine and the Session title are each dropped when there is none: a local
 * window runs `pi - Hulala`, a remote one `root@dev:pi - Hulala`, and the Host's
 * name for the Session hangs off the product name so a truncated tab keeps the
 * place it is working in. Every part is plain text: the terminal adapter
 * replaces control characters before the sequence is written.
 * @param cwd - the directory the open Session works in.
 * @param title - the Host's Session title, if it has one yet.
 * @param options - the product name and the machine the window is attached to.
 * @returns the title to hand the terminal.
 */
export function windowTitle(cwd: string, title?: string, options: WindowTitleOptions = {}): string {
  const name = title?.trim() ?? ''
  const machine = machineLabel(options.machine)
  const directory = directoryLabel(cwd)
  const where = machine === undefined ? directory : `${machine}:${directory}`
  const head = `${where} - ${options.app ?? APP_TITLE}`
  return name === '' ? head : `${head}:${name}`
}

/**
 * The last path segment, which is what identifies a directory in a tab.
 *
 * A trailing separator names no directory of its own, so it is dropped first;
 * a path that is only a root has no segment to name and is its own label.
 * @param cwd - the path to label.
 */
function directoryLabel(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/u, '')
  if (trimmed === '') return cwd === '' ? '/' : cwd
  const name = basename(trimmed)
  return name === '' ? trimmed : name
}

/**
 * The machine the window works on, named only when it is not this machine.
 *
 * The account comes from the ssh configuration the window attached through
 * (`ssh -G`, read without opening a connection); the machine stays the alias the
 * user picked rather than the address it resolves to. A local window names no
 * machine: its directory alone says where the work is.
 * @param remote - the ssh destination this window attached through, if any.
 * @returns the identity, or undefined on a local window.
 */
export function attachedMachine(remote?: string): MachineIdentity | undefined {
  return remote === undefined ? undefined : remoteIdentity(remote)
}

/** What the window title plugin is told when it loads. */
export interface TitlePluginConfig {
  /** The ssh destination this window attached through; absent on a local window. */
  readonly remote?: string
  /** The machine facts; defaults to the ssh configuration of `remote`. */
  readonly machine?: MachineIdentity
}

/** Put the derived title on the terminal, at boot and whenever the Session moves. */
export function apply(ctx: Context, config: TitlePluginConfig = {}): void {
  const session = ctx.hulalaSession
  const { setTitle } = ctx.hulalaTerminal
  // Resolved once: neither the account nor the alias changes while this process
  // is the window, and a Host switch ends it in a new process.
  const machine = config.machine ?? attachedMachine(config.remote)
  let shown: string | undefined

  const sync = (): void => {
    const current = session.id === undefined
      ? undefined
      : session.sessions.find(candidate => candidate.sessionId === session.id)
    const next = windowTitle(session.cwd, current?.title, { machine })
    // Every list event announces a change; only a different label is worth a
    // write to the terminal's tty.
    if (next === shown) return
    shown = next
    setTitle(next)
  }

  // The Session plugin is the only thing that knows the directory, so both
  // announcements are read: `opened` when the window switches Session, `changed`
  // for everything else, including the directory following the open Session.
  ctx.on('hulala/session-opened', () => { sync() })
  ctx.on('hulala/session-changed', () => { sync() })
  sync()
}

/** Cordis object-form plugin. */
export const titlePlugin = {
  name: 'hulala-title',
  inject: ['hulalaSession', 'hulalaTerminal'],
  apply,
}
