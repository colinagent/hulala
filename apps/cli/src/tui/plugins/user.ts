/**
 * The loader for plugins the user installed.
 *
 * Everything else in this directory is compiled into the client; this one is the
 * door for code that is not. It runs last, after every service exists, because a
 * user plugin may register into any of them.
 *
 * Two rules make it safe to have a door at all:
 *
 * - **One bad plugin never blocks boot.** A syntax error, a missing export or a
 *   throw from `activate` becomes one error line in the conversation; the rest of
 *   the window works. The alternative — refusing to start because one file in a
 *   config directory is broken — is how a client becomes unrecoverable.
 * - **Nothing is imported that the manifest did not declare.** The directory scan
 *   validates before this runs, so the only paths reached here are `./`-relative
 *   entries inside a package that identified itself.
 *
 * There is no sandbox. A plugin is ordinary ESM with the client's own
 * privileges; the contract is narrower than its power, and the documentation
 * says so.
 *
 * @module hulala-cli/tui/plugins/user
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { readPluginDirectory, type PluginDirectory } from '../../plugins/directory.js'
import type { PluginActivate } from '@hulala/plugin-sdk'
import { createPluginApi } from '../pluginApi.js'
import { t } from '../i18n/index.js'
import { withPluginTimeout } from '../../plugins/timeout.js'

/** Where the plugins are and how to talk about failures. */
export interface UserPluginsConfig {
  readonly dataRoot: string
  readonly debug: (message: string) => void
}

/** What one plugin did, for the conversation and for diagnostics. */
export interface ActivatedPlugin {
  readonly id: string
  readonly version: string
  readonly seats: number
  readonly commands: number
}

/**
 * Import one entry module and hand it the facade.
 *
 * A cache-busting query is what makes a second activation of the same file a
 * fresh module generation: Node's ESM registry would otherwise return the
 * previous one, which is exactly the failure a reload must not have.
 */
async function activateOne(
  ctx: Context,
  manifest: { id: string; version: string; entry: string; directory: string },
  dataRoot: string,
): Promise<ActivatedPlugin> {
  const url = pathToFileURL(join(manifest.directory, manifest.entry))
  url.searchParams.set('v', `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`)
  const module = await import(url.href) as { activate?: unknown; default?: unknown }
  const activate = (module.activate ?? module.default) as PluginActivate | undefined
  if (typeof activate !== 'function') throw new Error('the entry module exports no activate()')

  const api = createPluginApi(ctx, {
    id: manifest.id,
    name: manifest.id,
    version: manifest.version,
    apiVersion: 1,
    entry: manifest.entry,
    directory: manifest.directory,
  }, dataRoot)

  let seats = 0
  let commands = 0
  const counted = {
    ...api,
    seat: (...args: Parameters<typeof api.seat>) => { seats += 1; return api.seat(...args) },
    command: (...args: Parameters<typeof api.command>) => { commands += 1; return api.command(...args) },
  }
  const dispose = await withPluginTimeout(activate(counted), `plugin ${manifest.id}`)
  // A plugin that returns its own teardown gets it run before the facade's.
  if (typeof dispose === 'function') ctx.effect(() => dispose, `hulala: plugin ${manifest.id} teardown`)
  return { id: manifest.id, version: manifest.version, seats, commands }
}

/**
 * Load every enabled plugin.
 * @returns one row per plugin that activated, for `/status`.
 */
export async function loadUserPlugins(ctx: Context, config: UserPluginsConfig): Promise<PluginDirectory> {
  const directory = readPluginDirectory(config.dataRoot)
  const { reducer } = ctx.hulalaViewModel
  const render = ctx.hulalaRender

  for (const problem of directory.problems) {
    config.debug(`plugin ${problem.id} rejected: ${problem.message}`)
    reducer.addError(t('error.pluginLoad', { plugin: problem.id, reason: problem.message }))
  }

  for (const manifest of directory.manifests) {
    if (directory.disabled.has(manifest.id)) {
      config.debug(`plugin ${manifest.id} is disabled`)
      continue
    }
    try {
      const result = await activateOne(ctx, manifest, config.dataRoot)
      config.debug(`plugin ${manifest.id}@${result.version} activated: ${result.seats} seats, ${result.commands} commands`)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      config.debug(`plugin ${manifest.id} failed: ${message}`)
      reducer.addError(t('error.pluginLoad', { plugin: manifest.id, reason: message }))
    }
  }
  if (directory.problems.length > 0 || directory.manifests.length > 0) render.repaint()
  return directory
}

/** Cordis object-form plugin. */
export const userPluginsPlugin = {
  name: 'hulala-user-plugins',
  inject: [
    'hulalaRender',
    'hulalaLayout',
    'hulalaSession',
    'hulalaCommands',
    'hulalaViewModel',
    'hulalaTerminal',
    'hulalaPanes',
    'hulalaRail',
    'hulalaView',
    'hulalaUpdate',
    'hulalaComposer',
  ],
  apply: async (ctx: Context, config: UserPluginsConfig) => {
    await loadUserPlugins(ctx, config)
  },
}
