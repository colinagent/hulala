/**
 * The release the installed launcher will start next.
 *
 * A running client keeps the code it booted with, so after another terminal
 * installs a release this process is stale: its Host was stopped, its event
 * socket can never answer again, and the only way onto the new code is a new
 * process. Deciding *when* to do that needs one fact the client does not carry
 * anywhere else — which version `bin/hulala` would start — and that fact lives in
 * the launcher marker plus `active.json`.
 *
 * The launcher is the source of truth on purpose: it is the exact file
 * `restartClient()` executes, so reading it proves both that a restart is
 * possible and which release it would land on. A source checkout has no
 * launcher and reports `undefined`, which keeps `/update`'s "update the checkout
 * with git" path in charge there.
 *
 * @module hulala-cli/distribution/installedRelease
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { launcherRoot, readInstallation } from './install.js'

/** The installed release, as the private launcher resolves it. */
export interface InstalledRelease {
  /** Version the next `hulala` start runs. */
  readonly version: string
  /** Absolute path of the launcher a restart hands the terminal to. */
  readonly launcher: string
  /** Installation root holding `versions/` and `active.json`. */
  readonly root: string
}

/**
 * Where the private launcher lives inside a state root.
 * @param dataRoot - the Hulala state root.
 * @returns the launcher path (`bin/` is private and never on `PATH`).
 */
export function launcherPath(dataRoot: string): string {
  return join(dataRoot, 'bin', 'hulala')
}

/**
 * Read the release the launcher would start.
 *
 * Every failure is "unknown" rather than an error: a missing launcher is a
 * source checkout, an unreadable `active.json` is an installation in progress,
 * and neither may stop a client from running.
 *
 * A launcher on disk is not enough: a source checkout on a machine that also has
 * an installed TUI runs `hulala` from the checkout while `~/.hulala/bin/hulala`
 * belongs to the release. Only the launcher's own environment proves this
 * process came from the installation, so `HULALA_INSTALL_ROOT` has to name the
 * same root the launcher marker does.
 * @param dataRoot - the Hulala state root.
 * @param env - environment to read the install root from; tests override it.
 * @returns the installed release, or undefined when this process is not an
 *   installed one.
 */
export async function installedRelease(dataRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<InstalledRelease | undefined> {
  const installRoot = env.HULALA_INSTALL_ROOT?.trim()
  if (installRoot === undefined || installRoot === '') return undefined
  const launcher = launcherPath(dataRoot)
  const source = await readFile(launcher, 'utf8').catch(() => undefined)
  if (source === undefined) return undefined
  const root = launcherRoot(source)
  if (root === undefined || resolve(installRoot) !== root) return undefined
  const active = await readInstallation(root).catch(() => undefined)
  if (active === undefined) return undefined
  return { version: active.current.version, launcher, root }
}
