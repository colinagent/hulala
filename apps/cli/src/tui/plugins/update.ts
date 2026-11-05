/**
 * Self-update: the notice, the swap, and the flag that makes the client come
 * back as the new release.
 *
 * The *download* is never this plugin's business — `hulala update
 * --background` or `--download-only` fetches ahead of time, so by the time the
 * user chooses, the swap is a file rename and a restart. That split is what
 * makes `/update` feel like a restart instead of "quit and run it again".
 *
 * It owns three facts that used to be spread over the client: whether a release
 * is known, whether the notice was already shown, and whether the exit that just
 * started is a swap. Only the last one is read by somebody else — `shutdown()`
 * asks `restartWanted` to decide whether to hand the terminal over.
 *
 * @module hulala-cli/tui/plugins/update
 */
import type { Context } from '@deepseek-ai/cordis'
import { t } from '../i18n/index.js'
import type { UpdateInfo } from '../../update/check.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The pending release, its notice, and the swap flag. */
    hulalaUpdate: TuiUpdate
  }
  interface Events {
    /** A release was installed; the caller should close the window. */
    'hulala/update-installed'(): void
  }
}

/** What the client asks the updater for. */
export interface TuiUpdate {
  /** The newer release the background check found, if any. */
  readonly available: UpdateInfo | undefined
  /** Whether the exit now under way is a swap onto a new release. */
  readonly restartWanted: boolean
  /** Record what the background check found. */
  offer(info: UpdateInfo | undefined): void
  /**
   * Show the reminder once, and only for a Session that exists.
   *
   * The transcript is reset when a Session opens, so the check can finish before
   * the first one is open; the startup sequence announces from its end instead.
   */
  announce(): void
  /**
   * Install the release that is already on disk.
   * @returns the failure message, or undefined when the swap is ready.
   */
  install(): Promise<string | undefined>
}

/** Apply hook plus the notice sink. */
export interface UpdatePluginConfig {
  /** Runs `hulala update` the way the shell would; tests inject a fixed result. */
  readonly applyUpdate?: () => Promise<{ ok: boolean; message: string }>
}

/** Provide the updater. */
export function apply(ctx: Context, config: UpdatePluginConfig): void {
  const render = ctx.hulalaRender
  const { reducer } = ctx.hulalaViewModel
  const session = ctx.hulalaSession

  let available: UpdateInfo | undefined
  let announced = false
  let restartWanted = false

  ctx.provide('hulalaUpdate', {
    get available() { return available },
    get restartWanted() { return restartWanted },
    offer: (info: UpdateInfo | undefined) => {
      available = info
    },
    announce: () => {
      // A notice needs a transcript. The background check usually finishes
      // before the first Session exists, and repainting then paints nothing, so
      // the reminder waits instead of being spent unseen.
      if (available === undefined || announced || session.id === undefined) return
      announced = true
      reducer.addNotice(
        available.downloaded === true
          ? t('update.downloaded', { version: available.latestVersion })
          : t('update.available', { current: available.currentVersion, latest: available.latestVersion }),
        available.downloaded === true ? 'info' : 'warn',
      )
      render.repaint()
    },
    install: async () => {
      if (config.applyUpdate === undefined) return t('update.cannotSelf')
      reducer.addNotice(t('update.installing'))
      render.repaint()
      const result = await config.applyUpdate().catch((caught: unknown) => ({
        ok: false,
        message: caught instanceof Error ? caught.message : String(caught),
      }))
      if (!result.ok) {
        reducer.addError(result.message)
        render.repaint()
        return result.message
      }
      reducer.addNotice(result.message)
      restartWanted = true
      render.repaint()
      ctx.emit('hulala/update-installed')
      return undefined
    },
  })
}

/** Cordis object-form plugin. */
export const updatePlugin = {
  name: 'hulala-update',
  inject: ['hulalaRender', 'hulalaViewModel', 'hulalaSession'],
  apply,
}
