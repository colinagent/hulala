#!/usr/bin/env bun
/**
 * Cut, extract and verify `CHANGELOG.md`.
 *
 * The changelog is the release notes: this script turns the unreleased entries
 * into the section for the version in `package.json`, hands that same section to
 * the GitHub Release, and refuses a version bump with nothing to say. The
 * workflow calls `notes`, so a release page cannot be hand-written and cannot
 * disagree with the file a client prints.
 *
 *   bun run changelog:cut            # [Unreleased] -> [<version>] - <date>
 *   bun run changelog:notes          # the GitHub Release body on stdout
 *   bun run changelog:check          # the gate `bun run check` runs
 *
 * Every command takes `--version <x.y.z>` (default: the root manifest) and
 * `--file <path>` (default: `CHANGELOG.md`); `notes` also takes `--out <path>`.
 *
 * @module hulala/release/changelog
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { checkChangelog, cutRelease, parseChangelog, releaseBody } from '../../apps/cli/src/changelog/parse.ts'

const root = resolve(import.meta.dirname, '../..')

/** The two settings the release page must agree with the package. */
const PLATFORMS: ReadonlyArray<readonly [string, string]> = [
  ['macOS (Apple silicon)', 'darwin-arm64'],
  ['macOS (Intel)', 'darwin-x64'],
  ['Linux (x64)', 'linux-x64'],
  ['Linux (arm64)', 'linux-arm64'],
]

/**
 * The body `softprops/action-gh-release` publishes for one tag.
 *
 * The changelog section goes last: the download table is what a reader needs
 * first, and the entries are what the file is for.
 * @param markdown - the whole changelog.
 * @param version - the released version.
 * @returns the Markdown body, or undefined when the version has no section.
 */
export function releaseNotesMarkdown(markdown: string, version: string): string | undefined {
  const body = releaseBody(markdown, version)?.trim()
  if (body === undefined || body === '') return undefined
  return [
    'Download the archive for your platform and run `bin/hulala`, or install it:',
    '',
    '```sh',
    'curl -fsSL https://hulala.ai/install.sh | sh',
    '```',
    '',
    '| Platform | File |',
    '|---|---|',
    ...PLATFORMS.map(([platform, target]) => `| ${platform} | \`hulala-${version}-${target}.tar.gz\` |`),
    '',
    'The installer fetches the dependencies and, when Node.js 24.9+ is missing, a',
    'verified Node.js runtime; it needs nothing else from you.',
    '',
    `## What changed in ${version}`,
    '',
    body,
    '',
  ].join('\n')
}

/** One option's value, or undefined when the flag is absent. */
function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

/** Read the root manifest's version. */
async function manifestVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('package.json has no version')
  return manifest.version
}

/** The file every command reads unless `--file` names another one. */
function changelogPath(): string {
  const named = option('--file')
  return named === undefined ? join(root, 'CHANGELOG.md') : resolve(named)
}

async function cut(): Promise<number> {
  const version = option('--version') ?? await manifestVersion()
  const date = option('--date') ?? new Date().toISOString().slice(0, 10)
  const path = changelogPath()
  const before = await readFile(path, 'utf8')
  const after = cutRelease(before, version, date)
  await writeFile(path, after)
  const released = parseChangelog(after).releases.find(release => release.version === version)
  const count = released?.changes.reduce((total, change) => total + change.items.length, 0) ?? 0
  console.log(`${path}: released ${version} (${date}, ${count} entries); [Unreleased] is empty again`)
  return 0
}

async function notes(): Promise<number> {
  const version = option('--version') ?? await manifestVersion()
  const path = changelogPath()
  const body = releaseNotesMarkdown(await readFile(path, 'utf8'), version)
  if (body === undefined) {
    console.error(`${path} has no entries for ${version}; run bun run changelog:cut before tagging`)
    return 1
  }
  const out = option('--out')
  if (out === undefined) {
    process.stdout.write(body)
    return 0
  }
  await writeFile(resolve(out), body)
  console.log(`wrote ${out} (${version})`)
  return 0
}

async function check(): Promise<number> {
  const version = option('--version') ?? await manifestVersion()
  const path = changelogPath()
  const problems = checkChangelog(await readFile(path, 'utf8'), version)
  for (const problem of problems) console.error(`error: ${problem}`)
  if (problems.length > 0) {
    console.error(`
Changelog gate: ${problems.length} problem(s).
A release publishes the changelog section for the version in package.json; a
bumped manifest with no section would publish an empty release page. Bump the
version and run \`bun run changelog:cut\` in the same change.`)
    return 1
  }
  console.log(`Changelog gate: ok (${version})`)
  return 0
}

async function main(): Promise<number> {
  const command = process.argv[2]
  if (command === 'cut') return await cut()
  if (command === 'notes') return await notes()
  if (command === 'check') return await check()
  console.error('usage: bun scripts/release/changelog.ts <cut|notes|check> [--version x.y.z] [--date YYYY-MM-DD] [--file path] [--out path]')
  return 2
}

if (import.meta.main) process.exit(await main())
