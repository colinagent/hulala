import { join } from 'node:path'
import { VERSION } from './constants.js'
import { runDistributionCommand } from './distribution/commands.js'
import { attachHost, inspectHost, stopHost } from './hostAttach.js'
import { routeCommand } from './route.js'
import { createHostBackend } from './tui/data/remote.js'
import { attachRemote } from './hostAttach.js'
import { connectRemote, type RemoteCommandWord } from './remote/command.js'
import { listRemoteHosts } from './remote/ssh.js'
import { runTerminalClient } from './tui/app.js'
import { createTerminalKernel } from './tui/kernel.js'
import { readCreatorMode, writeCreatorMode, creatorModePath } from '@hulala/runtime/creator'
import { runHostPluginCommand } from './plugins/host.js'
import { resolvePaths } from './paths.js'
import { publishImeHelper } from './tui/editor/imeHelper.js'

function usage(): string {
  return [
    'Usage: hulala [--resume <id>]      attach to the Host and open the terminal client',
    '       hulala remote <ssh-host>            open it on another machine\'s Host',
    '       hulala ssh <ssh-host>               the same command, spelled with ssh',
    '       hulala host start|stop|status',
    '       hulala plugin --profile <name> add|remove|list <package>',
    '       hulala creator on|off|status',
    '       hulala install|rollback|uninstall|doctor [options]',
    '       hulala install bot                  install the Telegram/Lark bot plugin',
    '       hulala update [--check] [--version <x>]',
    '',
    'Terminal options:',
    '  --resume <id>              continue a saved Session',
    '  /help                      commands available inside the terminal client',
    '',
    'Update options:',
    '  --check                    report the latest release without installing',
    '  --download-only            fetch this release into the cache and stop',
    '  --background               fetch it in a detached process, then run update again',
    '  --version <x>              install one explicit release',
    '  --force                    reinstall even when already current',
  ].join('\n')
}

/** `hulala host start|stop|status` — manage the shared daemon. */
async function runHostCommand(args: string[]): Promise<number> {
  const action = args[0] ?? 'status'
  if (action === 'stop') {
    const result = await stopHost()
    console.log(result === 'absent' ? 'No Hulala Host is running.' : 'Hulala Host stopped.')
    return 0
  }
  if (action !== 'start' && action !== 'status') throw new Error(`Unknown host command: ${args.join(' ')}\n\n${usage()}`)
  if (action === 'status') {
    const inspected = await inspectHost()
    if (inspected.state === 'stopped') {
      console.log(JSON.stringify({ state: 'stopped' }, null, 2))
      return 0
    }
    // A Host whose declared composition did not fully activate still answers,
    // so the roster travels with the rest of its facts: `plugins` is what it
    // loaded, `degraded` is what it promised and did not. Exit stays 0 because
    // remote probes parse this document and treat a non-zero exit as unreachable.
    const degraded = inspected.state === 'running' ? inspected.health.degraded ?? [] : []
    console.log(JSON.stringify({
      state: inspected.state,
      pid: inspected.record.pid,
      protocol: inspected.record.protocol,
      version: inspected.record.version,
      instanceId: inspected.record.descriptor.instanceId,
      httpUrl: inspected.record.descriptor.httpUrl,
      ...(inspected.state === 'running'
        ? { plugins: (inspected.health.plugins ?? []).length, degraded }
        : {}),
    }, null, 2))
    if (degraded.length > 0) {
      const rows = degraded.map(row => `${row.module}@${row.version} (${row.state})`).join(', ')
      console.error(`hulala: ${String(degraded.length)} plugin(s) did not activate: ${rows}`)
    }
    return 0
  }
  // Distinguish "this command started a Host" from "a Host was already
  // answering". They print the same facts, and a user who stopped a Host,
  // installed a plugin, and then ran `start` needs to know which one happened:
  // a process that booted before the install never loads the new version.
  const before = await inspectHost()
  const attached = await attachHost()
  console.log(JSON.stringify({
    state: 'running',
    pid: attached.record.pid,
    protocol: attached.record.protocol,
    version: attached.record.version,
    instanceId: attached.record.descriptor.instanceId,
    httpUrl: attached.baseUrl,
    started: before.state !== 'running',
  }, null, 2))
  if (before.state === 'running') {
    const since = before.state === 'running' ? before.health.startedAt : 'unknown'
    console.error(`hulala: the Host was already running (pid ${String(before.record.pid)}, started ${since}); nothing was started.`)
    const degraded = before.state === 'running' ? before.health.degraded ?? [] : []
    if (degraded.length > 0) {
      console.error(`hulala: ${String(degraded.length)} plugin(s) are not active: ${degraded.map(row => `${row.module}@${row.version} (${row.state})`).join(', ')}`)
    }
  }
  return 0
}

/**
 * `hulala creator on|off|status` — the opt-in that lets the agent write plugins.
 *
 * It only writes the setting; the Host applies it on its next start, which is
 * where the composition is decided. `status` prints which file it read so a
 * confusing result is one `cat` away from being explained.
 * @param args - the action, defaulting to `status`.
 * @returns process exit code.
 */
function runCreatorCommand(args: string[]): number {
  const configDir = join(resolvePaths().data, 'config')
  const action = args[0] ?? 'status'
  if (action === 'status') {
    const enabled = readCreatorMode(configDir)
    console.log(JSON.stringify({ creatorMode: enabled ? 'on' : 'off', file: creatorModePath(configDir) }, null, 2))
    return 0
  }
  if (action !== 'on' && action !== 'off') throw new Error(`Unknown creator command: ${args.join(' ')}\n\n${usage()}`)
  writeCreatorMode(configDir, action === 'on')
  console.log(action === 'on'
    ? 'Creator mode on. Run `hulala host stop` so the Host restarts with the plugin-writing tools.'
    : 'Creator mode off.')
  return 0
}

/**
 * Default command: the terminal client. It attaches to this machine's Host and
 * only starts one when nothing answers, so quitting the terminal never stops a
 * running turn.
 */
async function runTerminal(args: string[]): Promise<number> {
  let resume: string | undefined
  // Internal, and set by the client itself when it restarts into another Host.
  // `/remote` is the way a user gets here; a flag nobody documents is the one
  // place a host switch can be re-established after the process is replaced.
  let remote: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--resume') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`--resume requires a Session id\n\n${usage()}`)
      resume = value
      index += 1
      continue
    }
    if (argument === '--remote') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`--remote requires an ssh destination\n\n${usage()}`)
      remote = value
      index += 1
      continue
    }
    throw new Error(`Unknown option: ${argument}\n\n${usage()}`)
  }
  // A remote attachment owns a tunnel, and the tunnel reads the remote endpoint
  // instead of discovering a daemon here: a client that asked for another
  // machine must never start a local Host beside it.
  // The switch already closed the previous window, so the one thing this process
  // must do on failure is say which machine it could not reach and why.
  const remoteAttachment = remote === undefined
    ? undefined
    : await attachRemote(remote).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`could not attach to ${remote}: ${reason}`)
    })
  const attached = remoteAttachment ?? await attachHost()
  // A packaged install ships `bin/ime` and `publishEditor` copies it beside the
  // editor, so the input-source switch needs no help there. A source checkout
  // has no package to copy from, and a window whose helper was never built looks
  // exactly like a broken switch: build it here, once per change to the C file,
  // before the window opens. It stays on this entry rather than in the window
  // itself, so the tests that boot the client never write to a state root.
  publishImeHelper(join(resolvePaths().data, 'bin'))
  // One window is one context: the transport is installed on it, the client
  // provides the backend on it, and closing the window disposes the whole tree.
  const kernel = createTerminalKernel()
  try {
    const backend = await createHostBackend(attached, kernel.ctx)
    try {
      return await runTerminalClient({
        backend,
        kernel,
        cwd: process.cwd(),
        ...(remote === undefined ? {} : { remote }),
        ...(remoteAttachment === undefined ? {} : { forward: remoteAttachment.forward }),
        ...(resume === undefined ? {} : { resume }),
      })
    } finally {
      await backend.close()
    }
  } finally {
    await kernel.dispose()
    remoteAttachment?.forward.close()
  }
}

/**
 * The help line for a `remote`/`ssh` invocation that named no machine.
 *
 * The list is the user's own ssh config, because those are the names this command
 * accepts: typing one of them is the whole argument.
 * @param command - the word the user typed.
 * @returns the usage block to print.
 */
function remoteUsage(command: RemoteCommandWord): string {
  const hosts = listRemoteHosts()
  return [
    `Usage: hulala ${command} <ssh-host>`,
    '',
    'A window on another machine, the same one `/remote` opens from inside a',
    'running client: the Host there is started when it is stopped, installed when',
    'it is missing, and always reached through your own ssh.',
    '',
    hosts.length === 0
      ? 'No hosts in ~/.ssh/config yet; add one there, then name it here.'
      : ['Machines in ~/.ssh/config:', ...hosts.map(host => `  ${host}`)].join('\n'),
  ].join('\n')
}

/**
 * `hulala remote <machine>` / `hulala ssh <machine>` — the client opens on that
 * machine's Host instead of this one's.
 *
 * `/remote` remains the in-window way to make the same choice; this entry exists
 * for the case where the user already knows the machine before any window opens.
 * @param command - the word the user typed.
 * @param args - arguments after that word.
 * @returns process exit code.
 */
async function runRemoteCommand(command: RemoteCommandWord, args: string[]): Promise<number> {
  const [alias, ...rest] = args
  if (alias === undefined) {
    console.error(remoteUsage(command))
    return 1
  }
  if (rest.length > 0) throw new Error(`one machine at a time, not ${args.join(' ')}\n\n${usage()}`)
  return await connectRemote(alias, { runClient: destination => runTerminal(['--remote', destination]) })
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  const route = routeCommand(args)
  if (route.kind === 'version') { console.log(VERSION); return 0 }
  if (route.kind === 'help') { console.log(usage()); return 0 }
  if (route.kind === 'distribution') return runDistributionCommand(route.command, route.args)
  if (route.kind === 'host') return await runHostCommand(route.args)
  if (route.kind === 'plugin') return await runHostPluginCommand(route.args)
  if (route.kind === 'creator') return runCreatorCommand(route.args)
  if (route.kind === 'remote') return await runRemoteCommand(route.command, route.args)
  return await runTerminal(route.args)
}
