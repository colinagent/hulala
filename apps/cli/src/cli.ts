import { join } from 'node:path'
import { VERSION } from './constants.js'
import { runDistributionCommand } from './distribution/commands.js'
import { attachHost, inspectHost, stopHost } from './hostAttach.js'
import { routeCommand } from './route.js'
import { createHostBackend } from './tui/data/remote.js'
import { runTerminalClient } from './tui/app.js'
import { createTerminalKernel } from './tui/kernel.js'
import { readCreatorMode, writeCreatorMode, creatorModePath } from '@hulala/runtime/creator'
import { runPluginCommand } from './plugins/cli.js'
import { resolvePaths } from './paths.js'
import { publishImeHelper } from './tui/editor/imeHelper.js'

function usage(): string {
  return [
    'Usage: hulala [--resume <id>]      attach to the Host and open the terminal client',
    '       hulala host start|stop|status',
    '       hulala plugin list|enable|disable|new|check',
    '       hulala creator on|off|status',
    '       hulala install|rollback|uninstall|doctor [options]',
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
    console.log(JSON.stringify({
      state: inspected.state,
      pid: inspected.record.pid,
      protocol: inspected.record.protocol,
      version: inspected.record.version,
      instanceId: inspected.record.descriptor.instanceId,
      httpUrl: inspected.record.descriptor.httpUrl,
    }, null, 2))
    return 0
  }
  const attached = await attachHost()
  console.log(JSON.stringify({
    state: 'running',
    pid: attached.record.pid,
    protocol: attached.record.protocol,
    version: attached.record.version,
    instanceId: attached.record.descriptor.instanceId,
    httpUrl: attached.baseUrl,
  }, null, 2))
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
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--resume') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`--resume requires a Session id\n\n${usage()}`)
      resume = value
      index += 1
      continue
    }
    throw new Error(`Unknown option: ${argument}\n\n${usage()}`)
  }
  const attached = await attachHost()
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
        ...(resume === undefined ? {} : { resume }),
      })
    } finally {
      await backend.close()
    }
  } finally {
    await kernel.dispose()
  }
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  const route = routeCommand(args)
  if (route.kind === 'version') { console.log(VERSION); return 0 }
  if (route.kind === 'help') { console.log(usage()); return 0 }
  if (route.kind === 'distribution') return runDistributionCommand(route.command, route.args)
  if (route.kind === 'host') return await runHostCommand(route.args)
  if (route.kind === 'plugin') return await runPluginCommand(route.args, resolvePaths().data)
  if (route.kind === 'creator') return runCreatorCommand(route.args)
  return await runTerminal(route.args)
}
