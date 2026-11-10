/**
 * Read, cut and verify the one `CHANGELOG.md`.
 *
 * The file is the single source for three surfaces: the transcript's
 * `/changelog`, the GitHub Release notes, and the release gate that refuses a
 * version bump with nothing to say. Every one of them reads this parser, so a
 * section cannot mean one thing to the client and another to the release.
 *
 * Parsing is deliberately textual. `cutRelease` splices the unreleased body
 * under a new heading and leaves every released section byte for byte, because a
 * normalizing rewrite of a released section is exactly the edit the changelog
 * rules forbid.
 *
 * @module hulala-cli/changelog/parse
 */

/** One `### Added`-style group inside a release. */
export interface ChangelogChange {
  /** The group label as written, for example `Added`. */
  readonly group: string
  /** The bullet paragraphs, with their Markdown preserved. */
  readonly items: readonly string[]
}

/** One `## [Unreleased]` or `## [x.y.z] - YYYY-MM-DD` section. */
export interface ChangelogRelease {
  /** The version, or undefined for the unreleased section. */
  readonly version: string | undefined
  /** The release date as written, when the heading carries one. */
  readonly date: string | undefined
  /** The section body exactly as written, without its heading. */
  readonly body: string
  /** The parsed groups, in the order the file lists them. */
  readonly changes: readonly ChangelogChange[]
}

/** The parsed file plus the structural problems a gate should report. */
export interface Changelog {
  /** Sections in file order, newest first in a well-formed file. */
  readonly releases: readonly ChangelogRelease[]
  /** Heading-level problems, for example an unknown or duplicated section. */
  readonly problems: readonly string[]
}

const VERSION_HEADING =
  /^##\s+\[?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)\]?(?:\s+[-—]\s+(\d{4}-\d{2}-\d{2}))?\s*$/
const UNRELEASED_HEADING = /^##\s+\[?unreleased\]?\s*$/i
const SECTION_START = /^##\s/
const GROUP_HEADING = /^###\s+(.+?)\s*$/
const BULLET = /^[-*]\s+(.+?)\s*$/

/** The groups of one section body, in order. */
function changesOf(body: string): ChangelogChange[] {
  const changes: Array<{ group: string; items: string[] }> = []
  let group: { group: string; items: string[] } | undefined
  let item: string[] | undefined
  const flush = (): void => {
    if (item !== undefined && group !== undefined) {
      const text = item.join(' ').trim()
      if (text !== '') group.items.push(text)
    }
    item = undefined
  }
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd()
    const heading = GROUP_HEADING.exec(line)
    if (heading !== null) {
      flush()
      group = { group: heading[1] ?? '', items: [] }
      changes.push(group)
      continue
    }
    const bullet = BULLET.exec(line)
    if (bullet !== null) {
      flush()
      if (group === undefined) {
        group = { group: '', items: [] }
        changes.push(group)
      }
      item = [bullet[1] ?? '']
      continue
    }
    if (line.trim() === '') {
      flush()
      continue
    }
    // A continuation line belongs to the bullet above it; a paragraph with no
    // bullet stays visible as its own entry rather than disappearing.
    item = item === undefined ? [line.trim()] : [...item, line.trim()]
  }
  flush()
  return changes
}

/**
 * Split a changelog into its sections.
 * @param markdown - the whole file.
 * @returns the sections in file order and any heading-level problems.
 */
export function parseChangelog(markdown: string): Changelog {
  const lines = markdown.split('\n')
  const releases: ChangelogRelease[] = []
  const problems: string[] = []
  const versions = new Set<string>()
  let current: { release: ChangelogRelease; body: string[] } | undefined
  const finish = (): void => {
    if (current === undefined) return
    const body = current.body.join('\n')
    releases.push({ ...current.release, body, changes: changesOf(body) })
    current = undefined
  }
  for (const line of lines) {
    if (!SECTION_START.test(line)) {
      current?.body.push(line)
      continue
    }
    const unreleased = UNRELEASED_HEADING.test(line)
    const versioned = VERSION_HEADING.exec(line)
    if (!unreleased && versioned === null) {
      problems.push(`unexpected section heading: "${line.trim()}"`)
      continue
    }
    finish()
    if (unreleased) {
      if (versions.has('')) problems.push('the [Unreleased] section appears twice')
      versions.add('')
      current = { release: { version: undefined, date: undefined, body: '', changes: [] }, body: [] }
      continue
    }
    const version = versioned?.[1] ?? ''
    if (versions.has(version)) {
      problems.push(`the ${version} section appears twice`)
      continue
    }
    versions.add(version)
    current = {
      release: { version, date: versioned?.[2], body: '', changes: [] },
      body: [],
    }
  }
  finish()
  return { releases, problems }
}

/**
 * The body of one released section.
 * @param markdown - the whole file.
 * @param version - the version to read.
 * @returns the section without its heading, trimmed, or undefined when absent.
 */
export function releaseBody(markdown: string, version: string): string | undefined {
  const release = parseChangelog(markdown).releases.find(candidate => candidate.version === version)
  return release?.body.trim()
}

/**
 * Turn the unreleased entries into the section for a release.
 *
 * The released sections are copied through as raw lines, and the file keeps its
 * newest-first order: a fresh empty `[Unreleased]` section takes the old place
 * and the cut content becomes `## [version] - date` directly below it.
 * @param markdown - the whole file.
 * @param version - the version being released.
 * @param date - the release date, `YYYY-MM-DD`.
 * @returns the rewritten file.
 */
export function cutRelease(markdown: string, version: string, date: string): string {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`not a version: ${version}`)
  }
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
    throw new Error(`not a date: ${date}`)
  }
  const parsed = parseChangelog(markdown)
  if (parsed.releases.some(release => release.version === version)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`)
  }
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => UNRELEASED_HEADING.test(line))
  if (start < 0) throw new Error('CHANGELOG.md has no [Unreleased] section')
  let end = lines.length
  for (let index = start + 1; index < lines.length; index++) {
    if (SECTION_START.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .replace(/^\n+/u, '')
    .replace(/\s+$/u, '')
  if (body === '') throw new Error('the [Unreleased] section is empty; there is nothing to release')
  const rebuilt = [
    ...lines.slice(0, start),
    '## [Unreleased]',
    '',
    `## [${version}] - ${date}`,
    '',
    body,
    '',
    ...lines.slice(end),
  ]
  return rebuilt.join('\n')
}

/**
 * The reasons this changelog cannot describe the shipped version.
 *
 * `check` calls this: a bumped manifest with no section is a release that would
 * publish an empty release page, so it fails before the tag exists.
 * @param markdown - the whole file.
 * @param version - the version in `package.json`.
 * @returns every problem, or an empty list when the file is ready.
 */
export function checkChangelog(markdown: string, version: string): string[] {
  const parsed = parseChangelog(markdown)
  const problems = [...parsed.problems]
  if (!parsed.releases.some(release => release.version === undefined)) {
    problems.push('CHANGELOG.md has no [Unreleased] section')
  }
  const released = parsed.releases.find(release => release.version === version)
  if (released === undefined) {
    problems.push(`CHANGELOG.md has no section for ${version}; run bun run changelog:cut`)
  } else if (released.changes.every(change => change.items.length === 0)) {
    problems.push(`the ${version} section has no entries`)
  }
  // The shipped version is the newest released section: an older section cannot
  // stand in for a release someone forgot to cut.
  const newest = parsed.releases.find(release => release.version !== undefined)
  if (newest !== undefined && newest.version !== version) {
    problems.push(`the newest released section is ${newest.version}, but the manifest says ${version}`)
  }
  return problems
}
