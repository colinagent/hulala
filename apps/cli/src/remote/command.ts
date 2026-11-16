/**
 * `hulala remote <machine>` and its `hulala ssh <machine>` synonym.
 *
 * `/remote` reaches the same Host from inside a running window; this entry is the
 * other end of the same decision: the user names the machine on the command line,
 * so no window has to be opened and switched first. It reuses `/remote`'s own
 * pieces — the probe, the website installer, the daemon stop — and then hands the
 * process to the same client entry an in-window switch restarts into.
 *
 * @module hulala-cli/remote/command
 */
import { VERSION } from '../constants.js'
import { HOST_DAEMON_PROTOCOL } from '@hulala/host-client/node'
import {
  installRemote,
  liveSshRunner,
  resolveRemoteHost,
  stopRemoteHost,
  type RemoteHostState,
  type RemoteVerdict,
  type SshRunner,
} from './ssh.js'

/** The two words that open a window on another machine. */
export type RemoteCommandWord = 'remote' | 'ssh'

/** What one probe learned, in the shape both this command and `/remote` use. */
export interface RemoteProbe {
  readonly probe: RemoteHostState
  readonly verdict: RemoteVerdict
}

/** Everything `connectRemote` reaches outside itself, injected for tests. */
export interface RemoteConnectDeps {
  /** Open the terminal client, usually `runTerminal`. */
  runClient(alias: string): Promise<number>
  /** The ssh command runner; defaults to the system `ssh`. */
  readonly runner?: SshRunner
  /** The probe; defaults to `resolveRemoteHost` against this build. */
  readonly probe?: (alias: string, run: SshRunner) => Promise<RemoteProbe>
  /** The installer; defaults to the website's `install.sh` over ssh. */
  readonly install?: typeof installRemote
  /** Stops the remote daemon after an install; defaults to `hulala host stop` there. */
  readonly stop?: typeof stopRemoteHost
  /** Ordinary output; defaults to stdout. */
  readonly out?: (line: string) => void
  /** Refusals; defaults to stderr. */
  readonly fail?: (line: string) => void
}

/**
 * Attach this process to a Host on another machine.
 *
 * The order is the one `/remote` follows after its confirmation: probe, install
 * an uninstalled or older machine, stop the daemon the installer replaced, then
 * attach. Naming the machine on the command line is the confirmation, so nothing
 * asks twice; a machine this client cannot use is refused instead of changed.
 * @param alias - the ssh destination the user named.
 * @param deps - the client to open, plus injected ssh faces.
 * @returns the client's exit code, or 1 when the machine cannot serve a window.
 */
export async function connectRemote(alias: string, deps: RemoteConnectDeps): Promise<number> {
  const run = deps.runner ?? liveSshRunner()
  const out = deps.out ?? ((line: string): void => { console.log(line) })
  const fail = deps.fail ?? ((line: string): void => { console.error(line) })
  const probe = deps.probe
    ?? ((destination: string, ssh: SshRunner) => resolveRemoteHost(destination, ssh, {
      version: VERSION,
      protocol: HOST_DAEMON_PROTOCOL,
    }))
  const install = deps.install ?? installRemote
  const stop = deps.stop ?? stopRemoteHost

  out(`${alias}: checking the Host…`)
  const { probe: state, verdict } = await probe(alias, run)
  switch (verdict) {
    case 'attach':
      return await deps.runClient(alias)
    case 'start':
      fail(`${alias}: the Host did not stay up`)
      return 1
    case 'unreachable':
      fail(`${alias}: ${state.state === 'unreachable' ? state.reason : 'the Host cannot be reached'}`)
      return 1
    case 'client-update':
      fail(`${alias} runs a newer Hulala than this client; update this installation first`)
      return 1
    case 'install':
    case 'update':
      break
  }

  out(`${alias}: installing Hulala there…`)
  const installed = await install(alias, run)
  if (!installed.ok) {
    // The installer's own last line is the only thing that says why: a missing
    // `curl`, a full disk, a proxy that refuses the download.
    const last = installed.output.split('\n').map(line => line.trim()).filter(line => line !== '').at(-1)
    fail(`${alias}: install failed; nothing there changed.${last === undefined ? '' : ` ${last}`}`)
    return 1
  }
  // The installer replaces files; the daemon serving them is still the old
  // process. Stop it so the attach that follows starts the new release instead
  // of finding a Host that no longer matches this client.
  if (!await stop(alias, run)) {
    fail(`${alias}: the old Host did not stop; try again`)
    return 1
  }
  return await deps.runClient(alias)
}
