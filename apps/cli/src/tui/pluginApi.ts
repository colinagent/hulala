/**
 * The implementation behind the plugin contract.
 *
 * The contract itself — `PluginApi`, `SeatId`, the snapshot fields — is
 * declared once, in `@hulala/plugin-sdk`, and this file only builds an object
 * that satisfies it. That split is what keeps `packages/tui-plugin` honest: if
 * the implementation and the published types could drift, the types would be a
 * description of what somebody once intended.
 *
 * The surface is a facade over services, not a second plugin system: `seat()`
 * calls the frame's `register`, `command()` calls the command registry, `state()`
 * reads the session plugin. A built-in plugin and a user plugin are assembled by
 * the same kernel; this is the smaller door.
 *
 * @module hulala-cli/tui/pluginApi
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Component } from '@earendil-works/pi-tui'
import { PLUGIN_API_VERSION } from '../plugins/manifest.js'
import { t } from './i18n/index.js'
import type {
  Disposable,
  SeatId,
  PluginApi,
  PluginManifest,
  PluginView,
} from '@hulala/plugin-sdk'

/**
 * One line standing in for a seat entry that failed.
 *
 * It names the plugin so the user can find it, and it is clamped to the width so
 * a long id cannot break the frame it is already degrading.
 * @param width - columns available to the seat.
 */
function marker(width: number): string {
  const text = '⚠ plugin render failed'
  return text.length <= width ? text : text.slice(0, Math.max(0, width))
}

/**
 * Build the facade for one plugin.
 * @param ctx - the window's context, which owns every service behind it.
 * @param manifest - the plugin's manifest, for identity and its data directory.
 * @param dataRoot - the Hulala state root.
 * @returns the object handed to `activate`.
 */
export function createPluginApi(ctx: Context, manifest: PluginManifest, dataRoot: string): PluginApi {
  const layout = ctx.hulalaLayout
  const render = ctx.hulalaRender
  const session = ctx.hulalaSession
  const commands = ctx.hulalaCommands
  const { reducer } = ctx.hulalaViewModel
  const disposers: Disposable[] = []

  const dataDir = join(dataRoot, 'runtime', 'plugins', manifest.id)
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })

  const api: PluginApi = {
    apiVersion: PLUGIN_API_VERSION,
    dataDir,
    seat: (seat: SeatId, options: { id: string }, view: PluginView): Disposable => {
      // A plugin draws lines; the frame owns where they go and how tall they are.
      //
      // The try/catch is not defensive noise: pi-tui has no error boundary, so one
      // throwing `render()` loses the frame — every frame. A user plugin must be
      // able to break only its own rows. The failure is reported once and then
      // replaced by a one-line marker, which is also what the browser client does
      // with a crashing slot entry.
      let failed = false
      const component: Component = {
        render: (width: number) => {
          if (failed) return [marker(width)]
          try {
            const lines = view.render(width)
            if (!Array.isArray(lines) || lines.some(line => typeof line !== 'string')) {
              throw new Error('render() did not return string[]')
            }
            return lines
          } catch (caught) {
            failed = true
            const reason = caught instanceof Error ? caught.message : String(caught)
            reducer.addError(t('error.pluginRender', { plugin: manifest.id, id: options.id, reason }))
            render.request()
            return [marker(width)]
          }
        },
        invalidate: () => undefined,
      }
      const remove = layout.register(seat, { id: options.id, component })
      disposers.push(remove)
      return () => {
        remove()
        const index = disposers.indexOf(remove)
        if (index >= 0) disposers.splice(index, 1)
      }
    },
    command: (name: string, description: string, run: (argument: string) => void | Promise<void>): Disposable => {
      const remove = commands.registerCommand(name, description, run)
      disposers.push(remove)
      return () => {
        remove()
        const index = disposers.indexOf(remove)
        if (index >= 0) disposers.splice(index, 1)
      }
    },
    notice: (text: string) => {
      reducer.addNotice(text)
      render.repaint()
    },
    error: (text: string) => {
      reducer.addError(text)
      render.repaint()
    },
    refresh: () => { render.request() },
    state: () => ({
      sessionId: session.id,
      cwd: session.cwd,
      model: session.model === undefined ? undefined : { provider: session.model.provider, model: session.model.model },
      ...(session.thinkingLevel === undefined ? {} : { thinkingLevel: session.thinkingLevel }),
      busy: reducer.busy,
      turnStartedAt: reducer.turnStartedAt,
      metrics: {
        inputTokens: reducer.metrics.inputTokens,
        outputTokens: reducer.metrics.outputTokens,
        ...(reducer.metrics.contextTokens === undefined ? {} : { contextTokens: reducer.metrics.contextTokens }),
        ...(reducer.metrics.contextLimit === undefined ? {} : { contextLimit: reducer.metrics.contextLimit }),
      },
      disconnected: session.disconnected,
      sessions: session.sessions.map(row => ({
        id: row.sessionId,
        ...(row.title === undefined ? {} : { title: row.title }),
        ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
        running: row.running,
      })),
    }),
    log: (level: 'info' | 'error', message: string) => {
      const line = `[plugin ${manifest.id}] ${message}`
      if (level === 'error') console.error(line)
      else console.log(line)
    },
  }

  // One place that tears a plugin down: whatever it registered goes with it, in
  // the order the plugin itself gave, then the facade's leftovers.
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch {
        // A plugin's own cleanup failing must not stop the window from closing.
      }
    }
  }, `hulala: plugin ${manifest.id}`)

  return api
}
