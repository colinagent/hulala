/**
 * `hulala plugin` — the user-facing half of the plugin door.
 *
 * `check` is the reason this exists. The terminal has no page to look at, so the
 * only honest way to verify a plugin before installing it is to run its
 * `activate` against a recording stand-in and render what it registered. That
 * catches the failures that actually happen — no `activate` export, a method the
 * contract does not have, a `render` that returns something other than strings —
 * without pretending to prove what the plugin looks like.
 *
 * It proves nothing about layout, focus or timing. `check` says so in its output
 * instead of printing a green tick.
 *
 * @module hulala-cli/plugins/cli
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isProblem, readManifest, PLUGIN_API_VERSION, type PluginManifest } from './manifest.js'
import { pluginsRoot, readPluginDirectory, setEnabled } from './directory.js'
import { withPluginTimeout } from './timeout.js'
import type { Disposable, PluginActivate, PluginApi, PluginSnapshot, PluginView } from '@hulala/plugin-sdk'

const USAGE = [
  'Usage: hulala plugin list',
  '       hulala plugin enable <id>',
  '       hulala plugin disable <id>',
  '       hulala plugin new <id>',
  '       hulala plugin check <id|path>',
].join('\n')

/** One recorded registration, for the render smoke test. */
interface RegisteredView {
  readonly seat: string
  readonly id: string
  readonly view: PluginView
}

/**
 * A stand-in `PluginApi` that records instead of drawing.
 *
 * Anything the real facade offers is here; anything it does not offer is absent,
 * so calling it is a type error for a TypeScript author and a runtime miss for a
 * plain-JS one — which is exactly the bug `check` is meant to surface first.
 */
function recordingApi(registrations: RegisteredView[], commands: string[]): PluginApi {
  const noop = (): void => undefined
  return {
    apiVersion: PLUGIN_API_VERSION,
    dataDir: '',
    seat: (seat, options, view): Disposable => {
      registrations.push({ seat, id: options.id, view })
      return noop
    },
    command: (name = 'command'): Disposable => {
      commands.push(name)
      return noop
    },
    notice: noop,
    error: noop,
    refresh: noop,
    // A plugin that reads state during activate gets an empty window, which is
    // the point: `check` must work before a Host is attached.
    state: (): PluginSnapshot => ({
      sessionId: undefined,
      cwd: process.cwd(),
      model: undefined,
      busy: false,
      turnStartedAt: undefined,
      metrics: { inputTokens: 0, outputTokens: 0 },
      disconnected: true,
      sessions: [],
    }),
    log: (level, message) => {
      if (level === 'error') process.stderr.write(`${message}\n`)
    },
  } as PluginApi
}

/** Load one manifest from an id under the plugins root, or from an explicit path. */
function resolveTarget(dataRoot: string, target: string): { manifest: PluginManifest } | { error: string } {
  const directory = target.includes('/') || target.startsWith('.') ? target : join(pluginsRoot(dataRoot), target)
  if (!existsSync(directory)) return { error: `no plugin directory at ${directory}` }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  } catch {
    return { error: `${directory} has no readable package.json` }
  }
  const id = directory.split('/').pop() ?? target
  const read = readManifest(id, directory, parsed)
  return isProblem(read) ? { error: `${id}: ${read.message}` } : { manifest: read.manifest }
}

/**
 * Print every installed plugin and its declared state.
 * @param dataRoot - the Hulala state root.
 */
export function listPlugins(dataRoot: string): number {
  const directory = readPluginDirectory(dataRoot)
  const rows: string[] = []
  for (const manifest of directory.manifests) {
    const state = directory.disabled.has(manifest.id) ? 'disabled' : 'enabled'
    const description = manifest.description === undefined ? '' : `  ${manifest.description}`
    rows.push(`${manifest.id.padEnd(24)} ${manifest.version.padEnd(10)} ${state}${description}`)
  }
  for (const problem of directory.problems) rows.push(`${problem.id.padEnd(24)} ${'—'.padEnd(10)} invalid  ${problem.message}`)
  if (rows.length === 0) {
    process.stdout.write(`No TUI plugins. Add one under ${pluginsRoot(dataRoot)}.\n`)
    return 0
  }
  process.stdout.write(`${rows.join('\n')}\n`)
  return 0
}

/**
 * Switch one plugin on or off.
 * @param dataRoot - the Hulala state root.
 * @param id - the plugin directory name.
 * @param enabled - the state to record.
 */
export function togglePlugin(dataRoot: string, id: string, enabled: boolean): number {
  const directory = readPluginDirectory(dataRoot)
  if (!directory.manifests.some(manifest => manifest.id === id)) {
    process.stderr.write(`hulala: no plugin "${id}" under ${pluginsRoot(dataRoot)}\n`)
    return 1
  }
  setEnabled(dataRoot, id, enabled)
  process.stdout.write(`${enabled ? 'enabled' : 'disabled'} ${id}\n`)
  return 0
}

/**
 * Write the smallest plugin that does something visible.
 * @param dataRoot - the Hulala state root.
 * @param id - the new plugin's directory name.
 */
export function newPlugin(dataRoot: string, id: string): number {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) {
    process.stderr.write('hulala: a plugin id is lowercase letters, digits and dashes, starting with a letter\n')
    return 1
  }
  const directory = join(pluginsRoot(dataRoot), id)
  if (existsSync(directory)) {
    process.stderr.write(`hulala: ${directory} already exists\n`)
    return 1
  }
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({
    name: `hulala-plugin-${id}`,
    version: '0.1.0',
    private: true,
    type: 'module',
    description: `A Hulala TUI plugin: ${id}.`,
    hulala: { tui: { apiVersion: PLUGIN_API_VERSION, entry: './index.js' } },
  }, null, 2)}\n`)
  // No imports: the whole API arrives as the `activate` argument. That is what
  // makes a plugin a single file the client can load from a directory.
  writeFileSync(join(directory, 'index.js'), `/**
 * ${id} — a Hulala TUI plugin.
 *
 * \`activate\` receives the client's API. Register seats and commands; return a
 * function to undo anything you set up outside those.
 * @param {import('@hulala/plugin-sdk').PluginApi} tui
 */
export function activate(tui) {
  // A command is the cheapest thing to verify: /${id} in the composer.
  tui.command('${id}', 'Say hello from the ${id} plugin', () => {
    tui.notice('${id} was here')
  })

  // A seat draws rows. The frame decides where they go and how wide; the view
  // only answers "give me lines for this width".
  const seat = tui.seat('dock.status', { id: '${id}-session' }, {
    render: () => {
      const state = tui.state()
      if (state.sessionId === undefined) return ['']
      const model = state.model === undefined ? 'no model' : \`\${state.model.provider}/\${state.model.model}\`
      return [\`\${model} · \${state.busy ? 'running' : 'idle'}\`]
    },
  })

  // Anything registered through the facade is removed when the window closes.
  // Return a teardown only for resources you started yourself.
  return () => {
    seat()
  }
}
`)
  process.stdout.write(`created ${directory}\nnext: hulala plugin check ${id}\n`)
  return 0
}

/**
 * Validate one plugin, then activate it against a recording stand-in and render
 * everything it registered.
 * @param dataRoot - the Hulala state root.
 * @param target - a plugin id, or a path to its directory.
 * @param timeoutMs - how long `activate` may take; tests shorten it.
 */
export async function checkPlugin(dataRoot: string, target: string, timeoutMs?: number): Promise<number> {
  const resolved = resolveTarget(dataRoot, target)
  if ('error' in resolved) {
    process.stderr.write(`hulala: ${resolved.error}\n`)
    return 1
  }
  const { manifest } = resolved
  const entry = join(manifest.directory, manifest.entry)
  if (!existsSync(entry)) {
    process.stderr.write(`hulala: ${manifest.id}: no entry file at ${manifest.entry}\n`)
    return 1
  }

  const registrations: RegisteredView[] = []
  const commands: string[] = []
  try {
    const url = pathToFileURL(entry)
    // A fresh generation every run: a stale module would check the last version.
    url.searchParams.set('v', Date.now().toString(36))
    const module = await import(url.href) as { activate?: unknown; default?: unknown }
    const activate = (module.activate ?? module.default) as PluginActivate | undefined
    if (typeof activate !== 'function') throw new Error('the entry module exports no activate()')
    const dispose = await withPluginTimeout(activate(recordingApi(registrations, commands)), undefined, timeoutMs)
    if (typeof dispose === 'function') dispose()
  } catch (caught) {
    process.stderr.write(`hulala: ${manifest.id}: ${caught instanceof Error ? caught.message : String(caught)}\n`)
    return 1
  }

  const problems: string[] = []
  for (const registration of registrations) {
    for (const width of [20, 80, 200]) {
      let lines: unknown
      try {
        lines = registration.view.render(width)
      } catch (caught) {
        problems.push(`${registration.seat}/${registration.id} threw at width ${width}: ${caught instanceof Error ? caught.message : String(caught)}`)
        break
      }
      if (!Array.isArray(lines) || lines.some(line => typeof line !== 'string')) {
        problems.push(`${registration.seat}/${registration.id} did not return string[] at width ${width}`)
        break
      }
    }
  }

  process.stdout.write(`${manifest.id} ${manifest.version} — API ${manifest.apiVersion}\n`)
  process.stdout.write(`  activate: ok\n`)
  process.stdout.write(`  seats: ${registrations.length === 0 ? 'none' : registrations.map(seat => `${seat.seat}/${seat.id}`).join(', ')}\n`)
  process.stdout.write(`  commands: ${commands.length === 0 ? 'none' : commands.join(', ')}\n`)
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`hulala: ${manifest.id}: ${problem}\n`)
    return 1
  }
  process.stdout.write('  render: string[] at 20/80/200 columns\n')
  // Honesty over encouragement: this proved the contract, not the appearance.
  process.stdout.write('  not verified: layout, focus, key routing, live Host data\n')
  return 0
}

/**
 * Dispatch `hulala plugin …`.
 * @param args - arguments after `plugin`.
 * @param dataRoot - the Hulala state root.
 */
export async function runPluginCommand(args: readonly string[], dataRoot: string): Promise<number> {
  const [command, ...rest] = args
  if (command === undefined || command === 'list') return listPlugins(dataRoot)
  if (command === 'enable' || command === 'disable') {
    const id = rest[0]
    if (id === undefined) {
      process.stderr.write(`hulala: plugin ${command} needs an id\n${USAGE}\n`)
      return 1
    }
    return togglePlugin(dataRoot, id, command === 'enable')
  }
  if (command === 'new') {
    const id = rest[0]
    if (id === undefined) {
      process.stderr.write(`hulala: plugin new needs an id\n${USAGE}\n`)
      return 1
    }
    return newPlugin(dataRoot, id)
  }
  if (command === 'check') {
    const target = rest[0]
    if (target === undefined) {
      process.stderr.write(`hulala: plugin check needs an id or a directory\n${USAGE}\n`)
      return 1
    }
    return await checkPlugin(dataRoot, target)
  }
  process.stderr.write(`hulala: unknown plugin command "${command}"\n${USAGE}\n`)
  return 1
}
