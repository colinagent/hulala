import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkChangelog, cutRelease, parseChangelog, releaseBody } from '../apps/cli/src/changelog/parse.ts'
import { releaseNotesMarkdown } from '../scripts/release/changelog.ts'

const fixture = `# Changelog

Intro.

## [Unreleased]

### Added

- The next thing, with a [link](https://example.invalid/1).
- A second line
  that continues.

## [0.2.30] - 2026-11-10

### Added

- The first thing.

### Fixed

- One bug.
`

const root = join(import.meta.dirname, '..')

test('sections and their groups are read in file order', () => {
  const changelog = parseChangelog(fixture)
  expect(changelog.problems).toEqual([])
  expect(changelog.releases.map(release => release.version)).toEqual([undefined, '0.2.30'])
  expect(changelog.releases[0]?.date).toBeUndefined()
  expect(changelog.releases[0]?.changes).toEqual([{
    group: 'Added',
    items: ['The next thing, with a [link](https://example.invalid/1).', 'A second line that continues.'],
  }])
  expect(changelog.releases[1]?.date).toBe('2026-11-10')
  expect(changelog.releases[1]?.changes.map(change => change.group)).toEqual(['Added', 'Fixed'])
})

test('a duplicate or unknown heading is reported instead of guessed at', () => {
  const duplicated = `${fixture}\n## [0.2.30] - 2026-11-11\n\n### Added\n\n- Again.\n`
  expect(parseChangelog(duplicated).problems).toContain('the 0.2.30 section appears twice')
  const unknown = `# Changelog\n\n## Contents\n\n- something\n\n${fixture}`
  expect(parseChangelog(unknown).problems).toContain('unexpected section heading: "## Contents"')
})

test('one released body is extracted without its heading', () => {
  expect(releaseBody(fixture, '0.2.30')).toBe('### Added\n\n- The first thing.\n\n### Fixed\n\n- One bug.')
  expect(releaseBody(fixture, '9.9.9')).toBeUndefined()
})

test('cutting moves the unreleased entries under the new version', () => {
  const cut = cutRelease(fixture, '0.2.31', '2026-11-11')
  expect(cut).toContain('## [Unreleased]\n\n## [0.2.31] - 2026-11-11')
  const released = parseChangelog(cut)
  expect(released.problems).toEqual([])
  expect(released.releases.map(release => release.version)).toEqual([undefined, '0.2.31', '0.2.30'])
  // The new [Unreleased] section is empty, and the cut entries kept their text.
  expect(released.releases[0]?.changes).toEqual([])
  expect(released.releases[1]?.changes[0]?.items[1]).toBe('A second line that continues.')
  // A released section is copied through as raw lines, never re-rendered.
  const before = fixture.slice(fixture.indexOf('## [0.2.30]'))
  expect(cut.slice(cut.indexOf('## [0.2.30]'))).toBe(before)
})

test('cutting refuses an empty section, a duplicate version and a bad date', () => {
  const empty = '# Changelog\n\n## [Unreleased]\n\n## [0.2.30] - 2026-11-10\n\n### Added\n\n- x\n'
  expect(() => cutRelease(empty, '0.2.31', '2026-11-11')).toThrow('empty')
  expect(() => cutRelease(fixture, '0.2.30', '2026-11-11')).toThrow('already has a section')
  expect(() => cutRelease(fixture, '0.2.31', '11/11/2026')).toThrow('not a date')
  expect(() => cutRelease(fixture, 'next', '2026-11-11')).toThrow('not a version')
})

test('the gate refuses a version with no section and accepts a cut one', () => {
  expect(checkChangelog(fixture, '0.2.30')).toEqual([])
  const problems = checkChangelog(fixture, '0.2.31')
  expect(problems.some(problem => problem.includes('has no section for 0.2.31'))).toBe(true)
  // The newest released section has to be the shipped version.
  expect(problems.some(problem => problem.includes('newest released section is 0.2.30'))).toBe(true)
  const cut = cutRelease(fixture, '0.2.31', '2026-11-11')
  expect(checkChangelog(cut, '0.2.31')).toEqual([])
})

test('the record itself describes the version the manifests ship', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  expect(checkChangelog(changelog, manifest.version)).toEqual([])
  const body = releaseNotesMarkdown(changelog, manifest.version)
  expect(body).toContain(`## What changed in ${manifest.version}`)
  expect(body).toContain('curl -fsSL https://hulala.ai/install.sh | sh')
})

test('release notes carry the install block, every asset and the section body', () => {
  const body = releaseNotesMarkdown(fixture, '0.2.30')
  expect(body).toContain('| macOS (Apple silicon) | `hulala-0.2.30-darwin-arm64.tar.gz` |')
  expect(body).toContain('| macOS (Intel) | `hulala-0.2.30-darwin-x64.tar.gz` |')
  expect(body).toContain('| Linux (x64) | `hulala-0.2.30-linux-x64.tar.gz` |')
  expect(body).toContain('| Linux (arm64) | `hulala-0.2.30-linux-arm64.tar.gz` |')
  expect(body).toContain('## What changed in 0.2.30')
  expect(body).toContain('- One bug.')
  expect(body).not.toContain('The next thing')
  expect(releaseNotesMarkdown(fixture, '9.9.9')).toBeUndefined()
})
