/**
 * The changelog this build carries.
 *
 * The release bundle inlines `CHANGELOG.md` at build time (the two
 * `build`/`build-client` scripts define `__HULALA_CHANGELOG__`), so an installed
 * client can answer `/changelog` without looking for a file next to itself: an
 * archive has no repository checkout, and one lookup path is one less way for
 * shipped notes to go missing. An unbundled run — a test, `bun src/main.ts` —
 * reads the file from the checkout instead.
 *
 * @module hulala-cli/changelog
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseChangelog, type ChangelogRelease } from './parse.js'

declare const __HULALA_CHANGELOG__: string | undefined

/** The file an unbundled run reads: `apps/cli/src/changelog/` up to the root. */
const SOURCE_FILE = new URL('../../../../CHANGELOG.md', import.meta.url)

function embedded(): string {
  if (typeof __HULALA_CHANGELOG__ === 'string') return __HULALA_CHANGELOG__
  try {
    return readFileSync(fileURLToPath(SOURCE_FILE), 'utf8')
  } catch {
    // A client that cannot find its notes still runs; `/changelog` says so.
    return ''
  }
}

/** The whole changelog, inlined by the build or read from the checkout. */
export const CHANGELOG_MARKDOWN = embedded()

/**
 * The section describing this build's version.
 * @param markdown - the changelog text.
 * @param version - this build's version.
 * @returns the release, or undefined when the version has no section yet.
 */
export function releaseOf(markdown: string, version: string): ChangelogRelease | undefined {
  return parseChangelog(markdown).releases.find(release => release.version === version)
}
