/**
 * The plugin directory: `<data>/config/plugins/<id>/`.
 *
 * It sits under `config/` beside the Neovim plugins Hulala already reads, so the
 * state root keeps one answer to "where does user-owned configuration live". A
 * plugin owns its own directory; the client owns one sibling state file saying
 * which of them are switched off, because a disabled marker inside the package
 * would be lost the moment the user reinstalled it from their own checkout.
 *
 * @module hulala-cli/plugins/directory
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isProblem, readManifest, type ManifestProblem, type PluginManifest } from './manifest.js'

/** Everything the loader needs to know before it imports anything. */
export interface PluginDirectory {
  /** Manifests that passed validation, sorted by id. */
  readonly manifests: readonly PluginManifest[]
  /** Candidates that are not loadable, with the reason. */
  readonly problems: readonly ManifestProblem[]
  /** Ids the user switched off. */
  readonly disabled: ReadonlySet<string>
}

/** Which plugins are switched off. Kept beside the directory, not inside it. */
interface PluginState {
  readonly disabled: readonly string[]
}

/** Absolute path of the plugins root for one state root. */
export function pluginsRoot(dataRoot: string): string {
  return join(dataRoot, 'config', 'plugins')
}

/** Path of the enabled/disabled record. */
function statePath(dataRoot: string): string {
  return join(dataRoot, 'config', 'plugins.json')
}

/**
 * Read the enablement record.
 *
 * A corrupt or missing file means "everything enabled": the client must not
 * refuse to start because one small file was truncated by a crash.
 * @param dataRoot - the Hulala state root.
 * @returns the ids that are switched off.
 */
export function readDisabled(dataRoot: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath(dataRoot), 'utf8'))
    const disabled = (parsed as PluginState | null)?.disabled
    return new Set(Array.isArray(disabled) ? disabled.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

/**
 * Record one plugin's enablement.
 *
 * Written through a temporary file so a crash between the two writes leaves the
 * old record intact instead of an empty one.
 * @param dataRoot - the Hulala state root.
 * @param id - the plugin to switch.
 * @param enabled - the state to record.
 */
export function setEnabled(dataRoot: string, id: string, enabled: boolean): void {
  const disabled = readDisabled(dataRoot)
  if (enabled) disabled.delete(id)
  else disabled.add(id)
  const target = statePath(dataRoot)
  // The record lives beside the plugins root, which may not exist yet: nothing
  // else creates `config/` before the first enable or disable.
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ disabled: [...disabled].sort() }, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, target)
}

/**
 * Forget a plugin that is no longer installed, so the record cannot grow.
 * @param dataRoot - the Hulala state root.
 * @param ids - the ids that still exist.
 */
export function pruneState(dataRoot: string, ids: ReadonlySet<string>): void {
  const disabled = readDisabled(dataRoot)
  let changed = false
  for (const id of [...disabled]) {
    if (ids.has(id)) continue
    disabled.delete(id)
    changed = true
  }
  if (!changed) return
  try {
    // Through a temporary file like `setEnabled`: removing the old record first
    // would leave a window where a crash reads as "nothing is disabled", which
    // silently re-enables plugins the user switched off.
    const target = statePath(dataRoot)
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    const temporary = `${target}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify({ disabled: [...disabled].sort() }, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, target)
  } catch {
    // The record is a convenience; a failed prune must not break startup.
  }
}

/**
 * Scan the plugins root.
 *
 * Never throws: a missing root is an empty set, and one broken package does not
 * hide the others. That matters because the loader runs during boot.
 * @param dataRoot - the Hulala state root.
 * @returns the loadable manifests, the rejects, and the disabled set.
 */
export function readPluginDirectory(dataRoot: string): PluginDirectory {
  const root = pluginsRoot(dataRoot)
  const manifests: PluginManifest[] = []
  const problems: ManifestProblem[] = []
  let entries: string[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
      .map(entry => entry.name)
      .sort()
  } catch {
    return { manifests, problems, disabled: readDisabled(dataRoot) }
  }

  for (const id of entries) {
    const directory = join(root, id)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    } catch {
      // A directory without a package.json is not a plugin: `new` writes one, and
      // a half-copied folder should be ignorable rather than reported every boot.
      continue
    }
    const read = readManifest(id, directory, parsed)
    if (isProblem(read)) problems.push(read)
    else manifests.push(read.manifest)
  }

  const disabled = readDisabled(dataRoot)
  pruneState(dataRoot, new Set([...manifests, ...problems].map(entry => entry.id)))
  return { manifests, problems, disabled }
}
