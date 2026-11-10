import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHANGELOG_MARKDOWN, releaseOf } from '../../src/changelog/index.js'
import { parseChangelog } from '../../src/changelog/parse.js'
import { plainInline, releaseLines } from '../../src/changelog/render.js'
import { clientConfigPath, readClientPreferences, updateClientPreferences } from '../../src/clientPreferences.js'
import { writeClientLanguage } from '../../src/language.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hulala-changelog-'))
  roots.push(root)
  return root
}

const section = `## [1.2.3] - 2026-01-02

### Added

- A **bold** [link](https://example.invalid/a).
- Plain \`code\`.

### Fixed

- A bug.
`

test('an unbundled run carries the checkout changelog', () => {
  // A test runs from source, so `__HULALA_CHANGELOG__` is undefined and the
  // module reads the file; the release build takes the inlined branch.
  expect(CHANGELOG_MARKDOWN).toContain('# Changelog')
  expect(CHANGELOG_MARKDOWN).toContain('## [Unreleased]')
})

test('one release is looked up by exact version', () => {
  expect(releaseOf(CHANGELOG_MARKDOWN, '0.0.0')).toBeUndefined()
  expect(releaseOf(section, '1.2.3')?.date).toBe('2026-01-02')
})

test('inline Markdown becomes terminal text without losing the link target', () => {
  expect(plainInline('A **bold** [link](https://example.invalid/a).')).toBe('A bold link (https://example.invalid/a).')
  expect(plainInline('Plain `code` and __strong__.')).toBe('Plain code and strong.')
  expect(plainInline('![shot](https://example.invalid/p.png) caption')).toBe('shot caption')
  expect(plainInline('  wrapped\n  text  ')).toBe('wrapped text')
})

test('a release prints as a heading, group labels and bullets', () => {
  const release = parseChangelog(section).releases[0]
  expect(release).toBeDefined()
  expect(releaseLines(release!)).toEqual([
    'v1.2.3 — 2026-01-02',
    '',
    'Added',
    '  • A bold link (https://example.invalid/a).',
    '  • Plain code.',
    '',
    'Fixed',
    '  • A bug.',
  ])
})

test('the unreleased section prints without a date', () => {
  const release = parseChangelog('## [Unreleased]\n\n### Added\n\n- Next.\n').releases[0]
  expect(releaseLines(release!)).toEqual(['Unreleased', '', 'Added', '  • Next.'])
})

test('saving a language keeps the changelog marker, and the reverse', () => {
  const root = stateRoot()
  writeClientLanguage(root, 'zh-CN')
  updateClientPreferences(root, { changelogVersion: '0.2.30' })
  expect(JSON.parse(readFileSync(clientConfigPath(root), 'utf8'))).toEqual({
    language: 'zh-CN',
    changelogVersion: '0.2.30',
  })
  writeClientLanguage(root, 'en')
  const merged = JSON.parse(readFileSync(clientConfigPath(root), 'utf8')) as Record<string, unknown>
  expect(merged.language).toBe('en')
  expect(merged.changelogVersion).toBe('0.2.30')
  expect(readClientPreferences(root).values.changelogVersion).toBe('0.2.30')
})

test('a missing preferences file is reported as absent, not as a problem', () => {
  const read = readClientPreferences(stateRoot())
  expect(read.present).toBe(false)
  expect(read.values).toEqual({})
  expect(read.problem).toBeUndefined()
})
