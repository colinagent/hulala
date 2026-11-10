/**
 * What changed in this release: the startup block and `/changelog`.
 *
 * The text is the `CHANGELOG.md` this bundle inlined, so the release page, the
 * startup block and `/changelog` cannot disagree — one file, three readers.
 *
 * The startup block is spent once per state root and version: it waits for a
 * Session because the transcript is reset when the first one opens, and it
 * records the version in `config/client.json` so a second window on the same
 * release stays quiet. `/changelog` always reprints on request.
 *
 * @module hulala-cli/tui/plugins/changelog
 */
import type { Context } from '@deepseek-ai/cordis'
import { CHANGELOG_MARKDOWN, releaseOf } from '../../changelog/index.js'
import { parseChangelog, type ChangelogRelease } from '../../changelog/parse.js'
import { releaseLines } from '../../changelog/render.js'
import { readClientPreferences, updateClientPreferences } from '../../clientPreferences.js'
import { VERSION } from '../../constants.js'
import { resolvePaths } from '../../paths.js'
import { t } from '../i18n/index.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The changelog this build carries and its once-per-release announcement. */
    hulalaChangelog: TuiChangelog
  }
}

/** What the client asks the changelog for. */
export interface TuiChangelog {
  /**
   * Print this build's entries once, when this state root has not seen them.
   *
   * Called after the first Session opens: before that there is no transcript to
   * print into.
   */
  announce(): void
  /**
   * Print one release, or every recorded release.
   * @param argument - `all`, a version with or without its leading `v`, or empty
   *   for this build's version.
   */
  show(argument: string): void
}

/** State root plus the colour-free notice sink the transcript provides. */
export interface ChangelogPluginConfig {
  /** State root holding `config/client.json`; defaults to the process root. */
  readonly dataRoot?: string
}

/** Provide the announcement and the command. */
export function apply(ctx: Context, config: ChangelogPluginConfig = {}): void {
  const reducer = ctx.hulalaViewModel.reducer
  const session = ctx.hulalaSession
  const render = ctx.hulalaRender
  const lifecycle = ctx.hulalaLifecycle
  const dataRoot = config.dataRoot ?? resolvePaths().data
  const releases = parseChangelog(CHANGELOG_MARKDOWN).releases
  const current = releaseOf(CHANGELOG_MARKDOWN, VERSION)
  let announced = false

  const seen = (): string | undefined => {
    const value = readClientPreferences(dataRoot).values.changelogVersion
    return typeof value === 'string' ? value : undefined
  }

  /** Record the version as read; a preference must never fail a launch. */
  const mark = (): void => {
    try {
      updateClientPreferences(dataRoot, { changelogVersion: VERSION })
    } catch {
      // A read-only state root still runs; the block may repeat, nothing breaks.
    }
  }

  const print = (release: ChangelogRelease): void => {
    for (const line of releaseLines(release)) reducer.addNotice(line)
  }

  ctx.provide('hulalaChangelog', {
    announce: () => {
      if (announced || lifecycle.closing) return
      // The transcript is reset when a Session opens, so a block printed before
      // the first one would be spent unseen.
      if (session.id === undefined) return
      announced = true
      if (seen() === VERSION) return
      mark()
      if (current === undefined) return
      if (!current.changes.some(change => change.items.length > 0)) return
      reducer.addNotice(t('changelog.updated', { version: VERSION }))
      // The version is already in the heading above, so the release heading
      // itself is the one line that stays out of the startup block.
      for (const line of releaseLines(current).slice(1)) reducer.addNotice(line)
      render.repaint()
    },
    show: (argument: string) => {
      const token = argument.trim().replace(/^v/iu, '')
      if (token === 'all') {
        for (const release of releases) {
          if (release.version === undefined) continue
          print(release)
        }
      } else {
        const release = token === ''
          ? current
          : releases.find(candidate => candidate.version === token)
        if (release === undefined) {
          reducer.addNotice(t('changelog.none', { version: token === '' ? VERSION : token }))
          render.repaint()
          return
        }
        print(release)
      }
      mark()
      render.repaint()
    },
  })
}

/** Cordis object-form plugin. */
export const changelogPlugin = {
  name: 'hulala-changelog',
  inject: ['hulalaRender', 'hulalaViewModel', 'hulalaSession', 'hulalaLifecycle'],
  apply,
}
