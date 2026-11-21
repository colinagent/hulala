/**
 * Which machine a window is working on, written the way scp writes a remote path.
 *
 * A terminal tab is how a user finds the window again among a shell, an editor
 * and four Hulala Sessions, so a remote window names the machine the Session
 * works on: `root@dev:pi`. A local window names no machine — its directory alone
 * says where the work is, and `colin@host:` in front of every tab would be noise.
 *
 * A remote window can only name what it attached through. The alias the user
 * picked is the machine's name — not the address ssh resolves it to — and the
 * account comes from `ssh -G <alias>`, the configuration ssh itself would use,
 * which is read without opening a connection. Nothing here reaches the network.
 *
 * @module hulala-cli/machine
 */
import { spawnSync } from 'node:child_process'

/** The two halves of `user@host`, either of which may be unknown. */
export interface MachineIdentity {
  /** The account, or undefined when the machine would not say. */
  readonly user: string | undefined
  /** The machine: the ssh alias the window attached through. */
  readonly host: string
}

/**
 * The `user@host` label, or undefined when there is no machine to name.
 *
 * A machine that named itself but not its account still labels the window, as
 * the bare host: `dev:pi` is more use than a title that hides the one fact the
 * rail used to show.
 * @param identity - the machine facts, if any were resolved.
 * @returns the label, or undefined to leave the machine out of the title.
 */
export function machineLabel(identity: MachineIdentity | undefined): string | undefined {
  if (identity === undefined) return undefined
  return identity.user === undefined ? identity.host : `${identity.user}@${identity.host}`
}

/**
 * The machine a remote window attached through.
 *
 * The alias is kept as the host rather than the address it expands to: `dev` is
 * what the user typed and what their ssh config calls the machine, while the
 * resolved address is an implementation detail of their jump host.
 * @param alias - the ssh destination the window attached with.
 * @returns the identity to label the window with.
 */
export function remoteIdentity(alias: string): MachineIdentity {
  return { user: sshConfigUser(alias), host: alias }
}

/**
 * The `user` line of an `ssh -G` dump.
 *
 * `ssh -G` prints one `key value` pair per line, with the client's own defaults
 * filled in, so the last `user` line is the account a connection would use.
 * @param config - the dumped configuration.
 * @returns the account, or undefined when the dump has no usable line.
 */
export function parseSshConfigUser(config: string): string | undefined {
  let found: string | undefined
  for (const line of config.split('\n')) {
    const separator = line.indexOf(' ')
    if (separator < 0 || line.slice(0, separator) !== 'user') continue
    const value = line.slice(separator + 1).trim()
    if (value !== '') found = value
  }
  return found
}

/**
 * The account `ssh <alias>` would log in as, without connecting.
 *
 * ssh resolves the entry itself, so an include file, a `Match` block or the
 * client's default user all answer the same way the tunnel does. A machine with
 * no ssh binary, or an alias ssh refuses to expand, leaves the account unknown
 * and the title names the alias alone.
 * @param alias - the ssh destination.
 * @returns the account, or undefined when it could not be resolved.
 */
export function sshConfigUser(alias: string): string | undefined {
  try {
    const result = spawnSync('ssh', ['-G', alias], { encoding: 'utf8', timeout: 5_000, windowsHide: true })
    if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
    return parseSshConfigUser(result.stdout)
  } catch {
    return undefined
  }
}
