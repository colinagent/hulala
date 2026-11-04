/**
 * The ripgrep binary every Hulala install already carries, exposed on `PATH`.
 *
 * DeepSeek Harness ships ripgrep inside `@vscode/ripgrep-<platform>-<arch>` for
 * its own `grep` tool, so the binary is part of every release whether or not the
 * machine has ripgrep installed; the agent's `grep` calls it by absolute path and
 * never depends on `PATH`. Plain `rg` callers do: the editor column's
 * `<leader>fg` picker, and anything the model runs through `bash`. This module
 * resolves that shipped binary so both get it from the install instead of from
 * the user's package manager.
 *
 * A published copy lives in `<data>/bin/rg` beside the bundled Neovim, for the
 * same reason that binary is published: an install directory can be pruned or
 * rolled back after an upgrade, and the editor must keep working when it is.
 * Appending the directory (rather than prepending it) keeps the user's own tools
 * first, so Hulala only supplies what the machine is missing.
 *
 * @module hulala-cli/ripgrep
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** How to look for the binary; every field defaults to this process. */
export interface RipgrepLookupOptions {
  /** Packaged client root holding `bin/` and `runtime/`; absent in a checkout. */
  readonly packageRoot?: string | undefined
  /** Source checkout root, where workspace dependencies are hoisted. */
  readonly repositoryRoot?: string | undefined
  readonly platform?: NodeJS.Platform
  readonly arch?: string
}

/** Executable name, which only Windows decorates. */
export function ripgrepExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'rg.exe' : 'rg'
}

/** Directory a release package keeps the platform binary in. */
function dependencyDirectory(nodeModules: string, platform: NodeJS.Platform, arch: string): string {
  return join(nodeModules, '@vscode', `ripgrep-${platform}-${arch}`, 'bin')
}

/**
 * The ripgrep binary that travels with this build.
 *
 * A packaged client keeps it under `runtime/node_modules`; a source checkout
 * keeps the same package in the hoisted workspace `node_modules`. Without a
 * package root the checkout is the only candidate, so an installed client never
 * resolves a binary from an unrelated directory that happens to sit above it.
 *
 * @param options - roots and platform to resolve against.
 * @returns the absolute binary path, or undefined when neither location has it.
 */
export function bundledRipgrep(options: RipgrepLookupOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const candidates = options.packageRoot === undefined
    ? [join(options.repositoryRoot ?? fileURLToPath(new URL('../../../', import.meta.url)), 'node_modules')]
    : [join(options.packageRoot, 'runtime', 'node_modules')]
  for (const nodeModules of candidates) {
    const binary = join(dependencyDirectory(nodeModules, platform, arch), ripgrepExecutable(platform))
    if (existsSync(binary)) return binary
  }
  return undefined
}

/**
 * `PATH` entry that makes plain `rg` resolve to the binary this install ships.
 *
 * The published copy wins, because it survives pruning the install directory
 * that produced it; the packaged copy is what an install publishes from and what
 * a source checkout offers before anything is published.
 *
 * @param dataRoot - `~/.hulala` (or `$HULALA_HOME`).
 * @param options - roots and platform to resolve against.
 * @returns the directory to add to `PATH`, or undefined when no copy is present.
 */
export function ripgrepPathEntry(dataRoot: string, options: RipgrepLookupOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform
  const published = join(dataRoot, 'bin', ripgrepExecutable(platform))
  if (existsSync(published)) return dirname(published)
  const bundled = bundledRipgrep(options)
  return bundled === undefined ? undefined : dirname(bundled)
}

/**
 * `PATH` with one directory appended, keeping every existing entry first.
 * @param path - current `PATH` value; undefined starts an empty one.
 * @param entry - directory to append; undefined returns `path` unchanged.
 * @param platform - separator owner.
 * @returns the combined value, or undefined when there is nothing to return.
 */
export function appendPathEntry(
  path: string | undefined,
  entry: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (entry === undefined) return path
  const separator = platform === 'win32' ? ';' : ':'
  const entries = (path ?? '').split(separator).filter(value => value !== '')
  if (entries.includes(entry)) return path ?? entry
  return [...entries, entry].join(separator)
}
