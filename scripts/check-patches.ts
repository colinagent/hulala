/**
 * Verify that every `patchedDependencies` entry is actually applied.
 *
 * Bun keys a patch by **exact package version**. Bump the dependency and the key
 * stops matching, and nothing fails: the patch is silently not applied and the
 * build carries the unpatched upstream artifact. The symptom shows up much later
 * as a runtime bug that looks unrelated to the upgrade.
 *
 * So this checks two things per entry:
 *
 * 1. the installed version is the one the key names;
 * 2. every line the patch adds is present in the installed file.
 *
 * The second is what catches a patch file whose *target* moved — upstream emits
 * hashed asset names (`runner-launch-<hash>.js`), so a release can change the
 * patched file's name without changing the version.
 *
 * @module hulala/scripts/check-patches
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** One entry from `patchedDependencies`. */
export interface PatchEntry {
  readonly packageName: string
  readonly version: string
  readonly patchPath: string
}

/** One thing that is wrong. */
export interface PatchProblem {
  readonly key: string
  readonly message: string
}

/**
 * Decode a `patchedDependencies` key.
 *
 * The key is `<name>@<version>`; a scoped name contains an `@` of its own, so the
 * version is the part after the *last* one.
 * @param key - the map key.
 * @returns the parsed entry, or undefined when the key is malformed.
 */
export function parsePatchKey(key: string): { packageName: string; version: string } | undefined {
  const at = key.lastIndexOf('@')
  if (at <= 0 || at === key.length - 1) return undefined
  return { packageName: key.slice(0, at), version: key.slice(at + 1) }
}

/**
 * Everything the patch adds, per target file.
 *
 * Hunk headers are skipped; only added lines matter, because those are what would
 * be missing from an unpatched artifact.
 * @param patch - the patch file's text.
 * @returns added lines grouped by target path.
 */
export function addedLinesByFile(patch: string): Map<string, string[]> {
  const files = new Map<string, string[]>()
  let target: string | undefined
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ')) {
      target = line.slice(4).replace(/^b\//u, '').trim()
      files.set(target, [])
      continue
    }
    if (target === undefined) continue
    if (line.startsWith('+') && !line.startsWith('+++')) files.get(target)!.push(line.slice(1))
  }
  return files
}

/**
 * Check every entry.
 * @param repositoryRoot - the checkout whose `node_modules` and `patches/` to read.
 * @returns the problems found; empty means every patch is applied.
 */
export function checkPatches(repositoryRoot: string): PatchProblem[] {
  const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
    patchedDependencies?: Record<string, string>
  }
  const entries = manifest.patchedDependencies ?? {}
  const problems: PatchProblem[] = []

  for (const [key, patchRelative] of Object.entries(entries)) {
    const parsed = parsePatchKey(key)
    if (parsed === undefined) {
      problems.push({ key, message: 'the key is not "<package>@<version>"' })
      continue
    }
    const packageDir = join(repositoryRoot, 'node_modules', ...parsed.packageName.split('/'))
    let installed: string
    try {
      installed = (JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version?: string }).version ?? ''
    } catch {
      problems.push({ key, message: `${parsed.packageName} is not installed` })
      continue
    }
    if (installed !== parsed.version) {
      // The whole point of the check: bun would ignore this entry in silence.
      problems.push({
        key,
        message: `the key names ${parsed.version} but ${installed} is installed; the patch is NOT applied`,
      })
      continue
    }

    const patchPath = join(repositoryRoot, patchRelative)
    let patch: string
    try {
      patch = readFileSync(patchPath, 'utf8')
    } catch {
      problems.push({ key, message: `no patch file at ${patchRelative}` })
      continue
    }
    const files = addedLinesByFile(patch)
    if (files.size === 0) {
      problems.push({ key, message: 'the patch adds nothing' })
      continue
    }
    for (const [file, lines] of files) {
      const target = join(packageDir, file)
      let content: string
      try {
        content = readFileSync(target, 'utf8')
      } catch {
        problems.push({ key, message: `the patch targets ${file}, which is not in the package` })
        continue
      }
      const missing = lines.filter(line => line.trim() !== '' && !content.includes(line))
      if (missing.length > 0) {
        problems.push({
          key,
          message: `${file} does not contain ${missing.length} patched line(s); upstream likely renamed the artifact`,
        })
      }
    }
  }
  return problems
}

/**
 * Run the check and report on stdout.
 * @param repositoryRoot - defaults to this checkout.
 * @returns process exit code.
 */
export function main(repositoryRoot = resolve(import.meta.dirname, '..')): number {
  // `patches/` is addressed from the manifest, which is at the checkout root.
  const root = dirname(join(repositoryRoot, 'package.json')) === repositoryRoot ? repositoryRoot : repositoryRoot
  const problems = checkPatches(root)
  if (problems.length === 0) {
    process.stdout.write('patches: every patchedDependencies entry is applied\n')
    return 0
  }
  for (const problem of problems) process.stderr.write(`patches: ${problem.key}: ${problem.message}\n`)
  return 1
}

if (import.meta.main) process.exitCode = main()
