/**
 * Reaching a Host that runs on another machine, over the user's own SSH.
 *
 * Nothing here speaks SSH itself: the system `ssh` owns the alias, the keys, the
 * agent, ProxyJump, certificates and whatever the user's config already decided.
 * This module only shapes the three things a client needs — ask a remote Host
 * what it is, open one loopback tunnel to it, and install or update it through
 * the same `install.sh` the website serves.
 *
 * Every command runs through a **login shell**, because `ssh host cmd` is not one:
 * a user who installed Hulala through a version manager or `~/.local/bin` would
 * otherwise be told by a machine that has it that it has nothing.
 *
 * @module hulala-cli/remote/ssh
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Public installer the website serves; the client runs this same script. */
export const INSTALLER_URL = 'https://hulala.ai/install.sh'

/** The Host binary in a remote state root, as the state-root layout defines it. */
const REMOTE_COMMAND = '"$HOME/.hulala/bin/hulala"'

/**
 * Aliases the user configured, in file order.
 *
 * `Host *` and other patterns are skipped: they describe defaults for every
 * connection, not a machine anyone picks from a list. A `!pattern` is an
 * exclusion and is skipped for the same reason.
 * @param text - the contents of an ssh config file.
 * @returns the concrete aliases.
 */
export function hostsFromConfig(text: string): string[] {
  const aliases: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^host\s+(.+)$/iu.exec(line)
    if (match === null) continue
    for (const token of (match[1] ?? '').split(/\s+/u)) {
      if (token === '' || token.includes('*') || token.includes('?') || token.startsWith('!')) continue
      if (!aliases.includes(token)) aliases.push(token)
    }
  }
  return aliases
}

/**
 * The machines this user configured.
 * @param home - the user's home directory; tests pass their own.
 * @returns aliases, or none when there is no config to read.
 */
export function listRemoteHosts(home: string = homedir()): string[] {
  try {
    return hostsFromConfig(readFileSync(join(home, '.ssh', 'config'), 'utf8'))
  } catch {
    return []
  }
}

/** What one command over SSH came back with. */
export interface SshResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

/** Runs one login-shell command on a remote machine. */
export type SshRunner = (alias: string, command: string) => Promise<SshResult>

/** The Host state a probe learned, mirroring `hulala host status`. */
export type RemoteHostState =
  /** The machine answered, and has no Hulala command. */
  | { readonly state: 'uninstalled' }
  /** Installed, but no daemon answers for that state root. */
  | { readonly state: 'stopped'; readonly version: string; readonly protocol: number }
  /** A daemon answered. */
  | { readonly state: 'running'; readonly version: string; readonly protocol: number; readonly httpUrl: string }
  /** The machine could not be reached or could not answer. */
  | { readonly state: 'unreachable'; readonly reason: string }

/** Parse one `host status` document, tolerating fields an older release omits. */
function parseStatus(stdout: string): { state: string; version?: string; protocol?: number; httpUrl?: string } | undefined {
  const trimmed = stdout.trim()
  if (trimmed === '') return undefined
  // A login shell may print a banner before the JSON; the last object wins.
  const start = trimmed.lastIndexOf('{')
  if (start < 0) return undefined
  try {
    const value = JSON.parse(trimmed.slice(start)) as Record<string, unknown>
    return {
      state: typeof value.state === 'string' ? value.state : 'unknown',
      ...(typeof value.version === 'string' ? { version: value.version } : {}),
      ...(typeof value.protocol === 'number' ? { protocol: value.protocol } : {}),
      ...(typeof value.httpUrl === 'string' ? { httpUrl: value.httpUrl } : {}),
    }
  } catch {
    return undefined
  }
}

/**
 * Ask one machine what its Host is.
 *
 * `host status` never starts or stops anything, so a probe costs a connection
 * and nothing else — which is what makes it safe to run on every attempt.
 * @param alias - the ssh destination.
 * @param run - the command runner, injected so tests need no ssh.
 * @returns the state, or the reason it could not be read.
 */
export async function probeHost(alias: string, run: SshRunner): Promise<RemoteHostState> {
  const result = await run(alias, `if [ -x ${REMOTE_COMMAND} ]; then ${REMOTE_COMMAND} host status; else echo '{"state":"uninstalled"}'; fi`)
  if (result.code !== 0) return { state: 'unreachable', reason: result.stderr.trim() || `ssh exited ${String(result.code)}` }
  const status = parseStatus(result.stdout)
  if (status === undefined) return { state: 'unreachable', reason: 'the remote command printed nothing readable' }
  if (status.state === 'uninstalled') return { state: 'uninstalled' }
  if (status.state === 'running') {
    return {
      state: 'running',
      version: status.version ?? 'unknown',
      protocol: status.protocol ?? 0,
      httpUrl: status.httpUrl ?? '',
    }
  }
  return { state: 'stopped', version: status.version ?? 'unknown', protocol: status.protocol ?? 0 }
}

/** What the client should do about one probed machine. */
export type RemoteVerdict =
  /** Attach. */
  | 'attach'
  /** Installed and compatible, but no daemon: start it. */
  | 'start'
  /** Nothing installed: run the installer after the user agrees. */
  | 'install'
  /** Older Host: run the installer again; it upgrades in place. */
  | 'update'
  /** The Host speaks a newer protocol than this client: update the client. */
  | 'client-update'
  /** Nothing could be read: say so instead of guessing. */
  | 'unreachable'

/** The client facts a verdict needs. */
export interface ClientVersion {
  readonly version: string
  readonly protocol: number
}

/**
 * Compare one probe against this client.
 *
 * A Host with a different protocol cannot be attached to at all, and which side
 * is behind decides what to offer: an older Host is upgraded in place, a newer
 * one means this client is the stale half. Version strings are only compared for
 * equality — a release number that looks older is still attachable, so the
 * promise "never silently change the remote" holds.
 * @param host - what the probe found.
 * @param client - this client's release and protocol.
 * @returns what the caller should offer.
 */
export function verdictOf(host: RemoteHostState, client: ClientVersion): RemoteVerdict {
  if (host.state === 'unreachable') return 'unreachable'
  if (host.state === 'uninstalled') return 'install'
  // A stopped Host reports no version or protocol — the record is written by the
  // daemon that just left. Starting it is the only way to learn what is there,
  // so this is never "needs an update": the caller re-probes after starting.
  if (host.state === 'stopped') return 'start'
  if (host.protocol !== client.protocol) {
    return host.protocol > client.protocol ? 'client-update' : 'update'
  }
  if (host.version !== client.version) return 'update'
  return host.state === 'running' ? 'attach' : 'start'
}

/** One loopback forward to a remote Host, owned by this process. */
export interface Tunnel {
  /** Local port the Host is reachable on. */
  readonly port: number
  /** Stop the forward. Idempotent. */
  close(): void
}

/** Options for a tunnel: which machine, which ports, how long to wait. */
export interface TunnelOptions {
  readonly alias: string
  /** Local loopback port the client connects to. */
  readonly localPort: number
  /** The remote Host's loopback port, as its own endpoint record names it. */
  readonly remotePort: number
  /** Milliseconds to wait for the local end to accept connections. */
  readonly readyTimeoutMs?: number
}

/** Spawns the ssh process; injected so tests can stand in a forwarder. */
export type TunnelSpawner = (args: readonly string[]) => {
  kill(): void
  onExit(handler: (code: number | null) => void): void
}

/**
 * The ssh arguments for one forward.
 *
 * `ExitOnForwardFailure=yes` is what makes a refused forward fail loudly instead
 * of leaving a client that believes it is attached. `BatchMode=yes` keeps a
 * password prompt out of a headerless TUI; the first real connection is the
 * user's to make interactively. `ControlMaster=auto` shares the connection with
 * any other ssh the user runs to that host — the probe itself is a separate
 * process, so it may authenticate on its own unless the user's config already
 * declares a `ControlPath`.
 * @param alias - the ssh destination.
 * @param port - the loopback port on both ends.
 * @param controlPath - shared control socket, so the probe and the forward authenticate once.
 * @returns the argument list.
 */
export function tunnelArgs(alias: string, localPort: number, remotePort: number, controlPath?: string): string[] {
  return [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ControlMaster=auto',
    ...(controlPath === undefined ? [] : ['-o', `ControlPath=${controlPath}`]),
    '-N',
    '-L', `127.0.0.1:${String(localPort)}:127.0.0.1:${String(remotePort)}`,
    alias,
  ]
}

/**
 * Wait until a loopback port accepts a connection.
 * @param port - the forwarded port.
 * @param timeoutMs - how long to wait.
 * @returns true when something answers.
 */
async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const open = await new Promise<boolean>(resolve => {
      const socket = connect({ host: '127.0.0.1', port })
      const done = (value: boolean): void => {
        socket.removeAllListeners()
        socket.destroy()
        resolve(value)
      }
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
    })
    if (open) return true
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** The default spawner: the system ssh, detached from the client's stdio. */
export const spawnTunnel: TunnelSpawner = args => {
  const child = spawn('ssh', [...args], { stdio: 'ignore', windowsHide: true })
  return {
    kill: () => { child.kill('SIGTERM') },
    onExit: handler => { child.once('exit', code => handler(code)) },
  }
}

/**
 * Open one tunnel to a Host and wait until it answers.
 * @param options - machine, port and readiness budget.
 * @param spawner - the ssh spawner; tests pass a local forwarder.
 * @returns the tunnel, ready to use.
 * @throws when the forward never came up — the caller reports it instead of
 *   attaching to a port that is not there.
 */
export async function openTunnel(options: TunnelOptions, spawner: TunnelSpawner = spawnTunnel): Promise<Tunnel> {
  const child = spawner(tunnelArgs(options.alias, options.localPort, options.remotePort))
  let closed = false
  let exited = false
  const close = (): void => {
    if (closed) return
    closed = true
    child.kill()
  }
  child.onExit(() => {
    exited = true
    closed = true
  })
  const ready = await waitForPort(options.localPort, options.readyTimeoutMs ?? 12_000)
  if (!ready || exited) {
    close()
    throw new Error(`ssh could not forward 127.0.0.1:${String(options.localPort)} from ${options.alias}`)
  }
  return {
    port: options.localPort,
    close,
  }
}

/**
 * Install or update the Host on a remote machine, through the website's own script.
 *
 * One confirmation in the client covers the one question the script would ask
 * (`--yes`, which is only about downloading Node), and `HULALA_NO_START` keeps it
 * from launching a TUI on a machine nobody is sitting at.
 * @param alias - the ssh destination.
 * @param run - the command runner.
 * @returns the installer's combined output, for the client to show.
 */
export async function installRemote(alias: string, run: SshRunner): Promise<{ ok: boolean; output: string }> {
  const result = await run(alias, `HULALA_NO_START=1 curl -fsSL ${INSTALLER_URL} | sh -s -- --yes`)
  return { ok: result.code === 0, output: `${result.stdout}${result.stderr}` }
}

/**
 * Stop the Host daemon on a machine that has one installed.
 *
 * Installing replaces the files, not the process: a daemon started from the old
 * release keeps serving until it is stopped, so an update is `/remote`'s install
 * plus this, and the next attach starts the new one.
 * @param alias - the ssh destination.
 * @param run - the command runner.
 * @returns whether the daemon is gone (or was not running).
 */
export async function stopRemoteHost(alias: string, run: SshRunner): Promise<boolean> {
  const result = await run(alias, `${REMOTE_COMMAND} host stop`)
  return result.code === 0
}

/**
 * Start the Host daemon on a machine that has one installed.
 * @param alias - the ssh destination.
 * @param run - the command runner.
 * @returns whether it came up.
 */
export async function startRemoteHost(alias: string, run: SshRunner): Promise<boolean> {
  const result = await run(alias, `${REMOTE_COMMAND} host start`)
  return result.code === 0
}

/**
 * The spawn-based runner the client uses.
 *
 * The command is wrapped in a login shell because `ssh host cmd` inherits no
 * profile; `bash -lc` is the same shape VS Code's remote service uses.
 * @param ssh - the ssh executable to call.
 * @returns a runner that never throws: a failure is an exit code.
 */
export function liveSshRunner(ssh = 'ssh'): SshRunner {
  return (alias, command) => new Promise(resolve => {
    const child = spawn(ssh, ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', alias, `bash -l -c ${quote(command)}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', error => resolve({ code: null, stdout: '', stderr: error.message }))
    child.on('close', code => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }))
  })
}

/** Quote one command for a POSIX shell. */
export function quote(command: string): string {
  return `'${command.replace(/'/gu, `'\\''`)}'`
}
